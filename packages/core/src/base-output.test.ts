import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveBaseRef } from './base-output.js'

/** Runs `body` inside a throwaway repository with one commit, then restores the cwd. */
async function inRepo(body: (headSha: string) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'base-ref-test-'))
  const run = (...args: string[]) => execFileSync(
    'git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' },
  )
  run('init', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  await fsp.writeFile(path.join(dir, 'f'), 'x')
  run('add', '.')
  run('commit', '-m', 'first')
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim()

  const cwd = process.cwd()
  const savedEnv = process.env.L10N_SOURCE_BASE
  delete process.env.L10N_SOURCE_BASE
  process.chdir(dir)
  try {
    await body(headSha)
  } finally {
    process.chdir(cwd)
    if (savedEnv == null) {
      delete process.env.L10N_SOURCE_BASE
    } else {
      process.env.L10N_SOURCE_BASE = savedEnv
    }
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

describe('resolveBaseRef', () => {
  it('resolves the explicit ref to a commit sha', async () => {
    await inRepo(async headSha => {
      assert.equal(await resolveBaseRef('HEAD'), headSha)
    })
  })

  it('reads L10N_SOURCE_BASE when no ref is passed', async () => {
    await inRepo(async headSha => {
      process.env.L10N_SOURCE_BASE = 'HEAD'
      assert.equal(await resolveBaseRef(), headSha)
    })
  })

  it('prefers the explicit ref over the environment', async () => {
    await inRepo(async headSha => {
      process.env.L10N_SOURCE_BASE = 'refs/heads/nonexistent'
      assert.equal(await resolveBaseRef('HEAD'), headSha)
    })
  })

  it('ignores an empty L10N_SOURCE_BASE — CI expands an unset input to an empty string', async () => {
    await inRepo(async () => {
      process.env.L10N_SOURCE_BASE = ''
      // origin/HEAD 가 없는 리포이므로 자동 감지도 실패한다 → 호출자는 작업 트리로 폴백한다.
      assert.equal(await resolveBaseRef(), null)
    })
  })

  it('returns null for a ref that is not in this checkout', async () => {
    await inRepo(async () => {
      assert.equal(await resolveBaseRef('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'), null)
    })
  })
})
