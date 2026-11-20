import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getKeyModeRecordPath, readKeyModeRecord, removeKeyModeRecord, writeKeyModeRecord } from './key-mode-record.js'

describe('key mode record', () => {
  let tempDir: string
  let domainDir: string
  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'l10n-key-mode-record-'))
    domainDir = path.join(tempDir, 'cache', 'app')
  })
  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true })
  })

  it('returns the recorded key mode of the tag', async () => {
    await writeKeyModeRecord(domainDir, 'app', 'id')
    assert.equal(await readKeyModeRecord(domainDir, 'app'), 'id')

    await writeKeyModeRecord(domainDir, 'app', 'source')
    assert.equal(await readKeyModeRecord(domainDir, 'app'), 'source')
  })

  it('returns null without a record', async () => {
    assert.equal(await readKeyModeRecord(domainDir, 'app'), null)
  })

  it('removes the record', async () => {
    await writeKeyModeRecord(domainDir, 'app', 'id')
    await removeKeyModeRecord(domainDir)
    assert.equal(await readKeyModeRecord(domainDir, 'app'), null)
    // 기록이 없어도 실패하지 않는다
    await removeKeyModeRecord(domainDir)
  })

  it('ignores a record of another tag', async () => {
    await writeKeyModeRecord(domainDir, 'web', 'id')
    assert.equal(await readKeyModeRecord(domainDir, 'app'), null)
  })

  it('ignores an invalid record', async () => {
    await fsp.mkdir(domainDir, { recursive: true })
    for (const content of ['not json', 'null', '{"tag":"app","keyMode":"unknown"}']) {
      await fsp.writeFile(getKeyModeRecordPath(domainDir), content)
      assert.equal(await readKeyModeRecord(domainDir, 'app'), null, content)
    }
  })
})
