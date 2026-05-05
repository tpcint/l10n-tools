import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { readTransEntries } from './entry.js'
import type { SyncerKeySnapshot } from './plugin-types.js'
import { materializeSnapshotsToTempDir } from './source-filter.js'

function makeSnapshot(overrides: Partial<SyncerKeySnapshot> & { keyName: string }): SyncerKeySnapshot {
  return {
    keyName: overrides.keyName,
    isPlural: overrides.isPlural ?? false,
    contexts: overrides.contexts ?? [null],
    translations: overrides.translations ?? {},
  }
}

describe('materializeSnapshotsToTempDir', () => {
  it('writes one trans-{locale}.json per requested locale', async () => {
    const snapshots: SyncerKeySnapshot[] = [
      makeSnapshot({ keyName: 'hi', translations: { ko: { other: '안녕' }, en: { other: 'hi' } } }),
    ]
    const tempDir = await materializeSnapshotsToTempDir('domain', snapshots, ['ko', 'en'])
    try {
      const files = (await fsp.readdir(tempDir)).sort()
      assert.deepEqual(files, ['trans-en.json', 'trans-ko.json'])

      const ko = await readTransEntries(path.join(tempDir, 'trans-ko.json'))
      assert.equal(ko.length, 1)
      assert.equal(ko[0].key, 'hi')
      assert.equal(ko[0].context, null)
      assert.deepEqual(ko[0].messages, { other: '안녕' })
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('expands a snapshot into one entry per context', async () => {
    const snapshots: SyncerKeySnapshot[] = [
      makeSnapshot({
        keyName: 'k',
        contexts: ['ctx1', 'ctx2'],
        translations: { ko: { other: '값' } },
      }),
    ]
    const tempDir = await materializeSnapshotsToTempDir('domain', snapshots, ['ko'])
    try {
      const ko = await readTransEntries(path.join(tempDir, 'trans-ko.json'))
      assert.equal(ko.length, 2)
      const contexts = ko.map(e => e.context).sort()
      assert.deepEqual(contexts, ['ctx1', 'ctx2'])
      for (const entry of ko) {
        assert.deepEqual(entry.messages, { other: '값' })
      }
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('writes empty messages for locales missing in the snapshot', async () => {
    const snapshots: SyncerKeySnapshot[] = [
      makeSnapshot({ keyName: 'hi', translations: { ko: { other: '안녕' } } }),
    ]
    const tempDir = await materializeSnapshotsToTempDir('domain', snapshots, ['ko', 'en'])
    try {
      const en = await readTransEntries(path.join(tempDir, 'trans-en.json'))
      assert.equal(en.length, 1)
      assert.deepEqual(en[0].messages, {})
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('treats empty contexts array as a single null context', async () => {
    const snapshots: SyncerKeySnapshot[] = [
      makeSnapshot({ keyName: 'k', contexts: [], translations: { ko: { other: 'x' } } }),
    ]
    const tempDir = await materializeSnapshotsToTempDir('domain', snapshots, ['ko'])
    try {
      const ko = await readTransEntries(path.join(tempDir, 'trans-ko.json'))
      assert.equal(ko.length, 1)
      assert.equal(ko[0].context, null)
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true })
    }
  })
})
