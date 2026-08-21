import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DomainConfig } from './config.js'
import type { KeyEntry } from './entry.js'
import { pluginRegistry } from './plugin-registry.js'
import { findMissingOutputKeys, outputEntryId } from './compiler.js'

function makeKeyEntry(key: string, context: string | null = null): KeyEntry {
  return { key, context, isPlural: false, references: [], comments: [] }
}

function makeDomainConfig(outputTypes: string[]): DomainConfig {
  return new DomainConfig({
    type: 'vue-i18n',
    tag: 'test',
    locales: ['ko', 'en'],
    outputs: outputTypes.map(type => ({ type })),
  } as never)
}

/** Registers a compiler type whose output contains exactly `present`. */
function registerOutput(type: string, present: Set<string>): void {
  pluginRegistry.register({
    name: `test-${type}`,
    compilers: [{
      compilerTypes: [type],
      compilers: { [type]: async () => {} },
      outputKeyReaders: { [type]: async () => present },
    }],
  })
}

/** Registers a compiler type that cannot report its output. */
function registerReaderlessOutput(type: string): void {
  pluginRegistry.register({
    name: `test-${type}`,
    compilers: [{ compilerTypes: [type], compilers: { [type]: async () => {} } }],
  })
}

describe('findMissingOutputKeys', () => {
  it('reports keys the local source uses but the output does not contain', async () => {
    registerOutput('test-present-only-a', new Set([outputEntryId(null, 'a')]))

    const missing = await findMissingOutputKeys(
      'd',
      makeDomainConfig(['test-present-only-a']),
      [makeKeyEntry('a'), makeKeyEntry('b')],
      ['ko', 'en'],
    )

    assert.deepEqual(missing, new Set(['b']))
  })

  it('reports nothing when the output already contains every local key', async () => {
    registerOutput('test-present-all', new Set([outputEntryId(null, 'a'), outputEntryId(null, 'b')]))

    const missing = await findMissingOutputKeys(
      'd',
      makeDomainConfig(['test-present-all']),
      [makeKeyEntry('a'), makeKeyEntry('b')],
      ['ko', 'en'],
    )

    assert.deepEqual(missing, new Set())
  })

  it('returns null when any configured output cannot report its keys', async () => {
    // 부분적인 답은 위험하다 — 한 output 이라도 못 읽으면 호출자가 기존 동작으로 되돌아가야 한다.
    registerOutput('test-mixed-readable', new Set())
    registerReaderlessOutput('test-mixed-readerless')

    const missing = await findMissingOutputKeys(
      'd',
      makeDomainConfig(['test-mixed-readable', 'test-mixed-readerless']),
      [makeKeyEntry('a')],
      ['ko'],
    )

    assert.equal(missing, null)
  })

  it('unions the gap across outputs — missing from any one output counts', async () => {
    registerOutput('test-out-1', new Set([outputEntryId(null, 'a')]))
    registerOutput('test-out-2', new Set([outputEntryId(null, 'b')]))

    const missing = await findMissingOutputKeys(
      'd',
      makeDomainConfig(['test-out-1', 'test-out-2']),
      [makeKeyEntry('a'), makeKeyEntry('b')],
      ['ko'],
    )

    assert.deepEqual(missing, new Set(['a', 'b']))
  })

  it('matches on (context, key), not on key alone', async () => {
    // Android `<string name>` · iOS `.strings` 키처럼 같은 원문이 여러 context 로 쓰이는 도메인에서,
    // context 를 무시하면 "새 name 을 추가했는데 이미 있는 키" 로 오판한다 (#341 회귀).
    registerOutput('test-context', new Set([outputEntryId('a', 'k')]))

    const missing = await findMissingOutputKeys(
      'd',
      makeDomainConfig(['test-context']),
      [makeKeyEntry('k', 'a'), makeKeyEntry('k', 'b')],
      ['ko'],
    )

    assert.deepEqual(missing, new Set(['k']))
  })

  it('returns null for a domain with no configured output', async () => {
    const missing = await findMissingOutputKeys('d', makeDomainConfig([]), [makeKeyEntry('a')], ['ko'])
    assert.equal(missing, null)
  })
})
