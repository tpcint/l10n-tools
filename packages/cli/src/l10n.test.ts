import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readKeyEntries, writeKeyModeRecord, writeTransEntries } from 'l10n-tools-core'

// 동기화 대상에 접속하지 않는 명령을 실제 CLI 로 실행한다. 플러그인은 cwd 의 node_modules 에서 찾으므로
// 임시 프로젝트에 리포의 node_modules 를 연결한다. 플러그인은 빌드된 dist 를 쓰므로 pretest 가 빌드한다.
const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(cliDir, '..', '..')
const cliPath = path.join(cliDir, 'src', 'l10n.ts')
const tsxPath = path.join(repoDir, 'node_modules', '.bin', 'tsx')

const rc = {
  'domains': {
    app: {
      'type': 'android',
      'tag': 'app',
      'locales': ['ko'],
      'res-dir': 'res',
      'outputs': [{ 'type': 'android', 'res-dir': 'res' }],
    },
  },
  'sync-target': 'l10n-storage',
  'l10n-storage': { projectId: 'test-project' },
}

const stringsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:l10n="http://github.com/tpcint/l10n-tools">
    <string name="greeting" l10n:key="common_greeting">Hello</string>
</resources>
`

describe('offline commands use the recorded key mode', () => {
  let projectDir: string
  let domainCacheDir: string

  beforeEach(async () => {
    projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'l10n-cli-key-mode-'))
    domainCacheDir = path.join(projectDir, '.l10n-tools', 'app')
    await fsp.symlink(path.join(repoDir, 'node_modules'), path.join(projectDir, 'node_modules'), 'dir')
    await fsp.writeFile(path.join(projectDir, 'package.json'), '{"type":"module"}\n')
    await fsp.writeFile(path.join(projectDir, '.l10nrc'), JSON.stringify(rc, null, 2))
    await fsp.mkdir(path.join(projectDir, 'res', 'values'), { recursive: true })
    await fsp.writeFile(path.join(projectDir, 'res', 'values', 'strings.xml'), stringsXml)
    // download 가 공용 키 방식으로 받아 둔 번역
    await fsp.mkdir(domainCacheDir, { recursive: true })
    await writeTransEntries(path.join(domainCacheDir, 'trans-ko.json'), [
      { context: null, key: 'common_greeting', messages: { other: '안녕하세요' }, flag: null },
    ])
  })

  afterEach(async () => {
    await fsp.rm(projectDir, { recursive: true, force: true })
  })

  function runCli(...args: string[]) {
    const env = { ...process.env }
    delete env.L10N_SYNC_TARGET
    const result = spawnSync(tsxPath, ['--conditions', 'source', cliPath, ...args], { cwd: projectDir, encoding: 'utf-8', env })
    if (result.error != null) {
      throw result.error
    }
    return result
  }

  async function readExtractedKeys() {
    return (await readKeyEntries(path.join(domainCacheDir, 'keys.json')))
      .map(entry => ({ context: entry.context, key: entry.key }))
  }

  it('update extracts and compiles with the recorded id key mode', async () => {
    await writeKeyModeRecord(domainCacheDir, 'app', 'id')

    const result = runCli('update')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await readExtractedKeys(), [{ context: null, key: 'common_greeting' }])
    const koXml = await fsp.readFile(path.join(projectDir, 'res', 'values-ko', 'strings.xml'), { encoding: 'utf-8' })
    assert.match(koXml, /<string name="greeting">안녕하세요<\/string>/)
  })

  it('update extracts with source key mode without a record', async () => {
    const result = runCli('update')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await readExtractedKeys(), [{ context: 'greeting', key: 'Hello' }])
    const koXml = await fsp.readFile(path.join(projectDir, 'res', 'values-ko', 'strings.xml'), { encoding: 'utf-8' })
    assert.doesNotMatch(koXml, /안녕하세요/)
  })

  it('check reports no untranslated keys with the recorded id key mode', async () => {
    await writeKeyModeRecord(domainCacheDir, 'app', 'id')

    const result = runCli('check')
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(await readExtractedKeys(), [{ context: null, key: 'common_greeting' }])
  })

  it('check extracts with source key mode without a record', async () => {
    const result = runCli('check')
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.deepEqual(await readExtractedKeys(), [{ context: 'greeting', key: 'Hello' }])
    assert.match(result.stdout, /key {5}"Hello"/)
  })
})
