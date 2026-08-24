import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DomainConfig } from './config.js'
import type { KeyEntry } from './entry.js'
import { pluginRegistry } from './plugin-registry.js'
import { findMissingOutputKeys, outputEntryId } from './compiler.js'

function makeKeyEntry(key: string, context: string | null = null): KeyEntry {
  return { key, context, isPlural: false, references: [], comments: [] }
}

function makeDomainConfig(outputTypes: string[], targetPath?: string): DomainConfig {
  return new DomainConfig({
    type: 'vue-i18n',
    tag: 'test',
    locales: ['ko', 'en'],
    outputs: outputTypes.map(type => ({ type, ...(targetPath != null ? { 'target-path': targetPath } : {}) })),
  } as never)
}

/** Registers a compiler type whose output does not exist yet. */
function registerAbsentOutput(type: string): void {
  pluginRegistry.register({
    name: `test-${type}`,
    compilers: [{
      compilerTypes: [type],
      compilers: { [type]: async () => {} },
      outputKeyReaders: { [type]: async () => null },
    }],
  })
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

/**
 * Registers a compiler type whose reader reports whatever key names the JSON file at
 * `target-path` holds, so the same reader answers differently for the base copy and for
 * the working tree.
 */
function registerFileBackedOutput(type: string): void {
  pluginRegistry.register({
    name: `test-${type}`,
    compilers: [{
      compilerTypes: [type],
      compilers: { [type]: async () => {} },
      outputKeyReaders: {
        [type]: async (_domainName, config) => {
          try {
            const text = await fsp.readFile(config.getTargetPath(), { encoding: 'utf-8' })
            return new Set(Object.keys(JSON.parse(text) as object).map(key => outputEntryId(null, key)))
          } catch {
            return null
          }
        },
      },
    }],
  })
}

async function makeRepoWithCommittedOutput(committed: object): Promise<{ dir: string, outputPath: string }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'base-output-test-'))
  const outputPath = path.join(dir, 'trans.json')
  const run = (...args: string[]) => execFileSync(
    'git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' },
  )
  run('init', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  await fsp.writeFile(outputPath, JSON.stringify(committed))
  run('add', '.')
  run('commit', '-m', 'base output')
  return { dir, outputPath }
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

  it('returns null when an output does not exist yet — absent is not "everything is missing"', async () => {
    registerAbsentOutput('test-absent')

    const missing = await findMissingOutputKeys(
      'd',
      makeDomainConfig(['test-absent']),
      [makeKeyEntry('a')],
      ['ko'],
    )

    assert.equal(missing, null)
  })

  it('measures the gap against the base output, not against what a compile just wrote', async () => {
    // 스코프가 자기 관측 대상을 바꾸면 안 된다: 부분 Apply 로 'b' 가 작업 트리에 들어간 뒤에도
    // base 에는 없으므로 스코프에 남아야 한다. 그래야 나중에 도착한 로케일이 브랜치로 들어온다.
    registerFileBackedOutput('test-base-gap')
    const { dir, outputPath } = await makeRepoWithCommittedOutput({ a: 'ㄱ' })
    await fsp.writeFile(outputPath, JSON.stringify({ a: 'ㄱ', b: 'ㄴ' }))
    const domainConfig = makeDomainConfig(['test-base-gap'], outputPath)
    const keyEntries = [makeKeyEntry('a'), makeKeyEntry('b')]

    const cwd = process.cwd()
    process.chdir(dir)
    try {
      assert.deepEqual(
        await findMissingOutputKeys('d', domainConfig, keyEntries, ['ko'], 'HEAD'),
        new Set(['b']),
      )
      // 같은 상태를 작업 트리 기준으로 보면 'b' 는 이미 있으니 스코프에서 사라진다.
      assert.deepEqual(
        await findMissingOutputKeys('d', domainConfig, keyEntries, ['ko'], null),
        new Set(),
      )
    } finally {
      process.chdir(cwd)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('treats an output absent from the base as entirely new, not as unknown', async () => {
    registerFileBackedOutput('test-base-absent')
    const { dir } = await makeRepoWithCommittedOutput({ a: 'ㄱ' })
    const domainConfig = makeDomainConfig(['test-base-absent'], path.join(dir, 'later.json'))

    const cwd = process.cwd()
    process.chdir(dir)
    try {
      assert.deepEqual(
        await findMissingOutputKeys('d', domainConfig, [makeKeyEntry('a')], ['ko'], 'HEAD'),
        new Set(['a']),
      )
    } finally {
      process.chdir(cwd)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to the working tree when git cannot read the base ref', async () => {
    // ls-tree 실패는 "base 에 이 경로가 없음" 과 다르다. 빈 복사본을 그대로 base 로 삼으면 그
    // output 의 로컬 키가 전부 누락으로 잡혀 스코프가 과대해진다.
    registerFileBackedOutput('test-base-unreadable')
    const { dir, outputPath } = await makeRepoWithCommittedOutput({ a: 'ㄱ' })
    const domainConfig = makeDomainConfig(['test-base-unreadable'], outputPath)

    const cwd = process.cwd()
    process.chdir(dir)
    try {
      assert.deepEqual(
        await findMissingOutputKeys(
          'd',
          domainConfig,
          [makeKeyEntry('a'), makeKeyEntry('b')],
          ['ko'],
          'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ),
        new Set(['b']),
      )
    } finally {
      process.chdir(cwd)
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a domain with no configured output', async () => {
    const missing = await findMissingOutputKeys('d', makeDomainConfig([]), [makeKeyEntry('a')], ['ko'])
    assert.equal(missing, null)
  })
})
