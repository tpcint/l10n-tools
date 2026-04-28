import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyEntry, TransEntry } from 'l10n-tools-core'
import { L10nStorageApiClient } from '../api-client.js'
import type { L10nKeyToServe } from '../api-types.js'
import { syncTransToL10nStorage } from '../l10n-storage.js'
import {
  API_BASE,
  buildDomainConfig,
  buildL10nConfig,
  createProject,
  deleteProject,
  DEV_TOKEN,
  isL10nApiAvailable,
} from './helpers.js'

function key(k: string, opts?: { isPlural?: boolean, context?: string | null }): KeyEntry {
  return {
    key: k,
    isPlural: opts?.isPlural ?? false,
    context: opts?.context ?? null,
    references: [],
    comments: [],
  }
}

function trans(k: string, messages: Record<string, string>, opts?: { context?: string | null }): TransEntry {
  return {
    key: k,
    context: opts?.context ?? null,
    messages,
    flag: null,
  }
}

function findKey(keys: L10nKeyToServe[], keyName: string): L10nKeyToServe {
  const k = keys.find(x => x.keyName === keyName)
  if (!k) throw new Error(`key not found: ${keyName}`)
  return k
}

describe('syncTransToL10nStorage (e2e)', () => {
  let apiClient: L10nStorageApiClient
  let projectId: string | undefined

  before(async () => {
    if (!await isL10nApiAvailable()) {
      throw new Error(
        `tpc-agent l10n API not available at ${API_BASE}. ` +
        'Start it with: docker compose -f packages/syncer-l10n-storage/docker-compose.yml up -d --wait',
      )
    }
    process.env.TPC_AGENT_TOKEN = DEV_TOKEN
    apiClient = new L10nStorageApiClient(API_BASE, DEV_TOKEN)
  })

  beforeEach(async () => {
    await deleteProject(projectId)
    const created = await createProject('syncer-e2e', ['en', 'ko', 'ja'], 'en')
    projectId = created.projectId
  })

  after(async () => {
    await deleteProject(projectId)
  })

  it('creates new keys with suggestions on empty project', async () => {
    const config = buildL10nConfig(projectId!, { source: 'main' })
    const keyEntries = [key('greeting.hello'), key('greeting.bye')]
    const allTransData = {
      en: [trans('greeting.hello', { other: 'Hello' }), trans('greeting.bye', { other: 'Bye' })],
      ko: [trans('greeting.hello', { other: '안녕' })],
    }

    await syncTransToL10nStorage(config, buildDomainConfig(), 'web', keyEntries, allTransData, false)

    const keys = await apiClient.listAllKeysToServe(projectId!)
    assert.equal(keys.length, 2)

    const tagPair = (k: L10nKeyToServe) => k.tags.map(t => ({ tag: t.tag, source: t.source }))

    const hello = findKey(keys, 'greeting.hello')
    assert.deepEqual(tagPair(hello), [{ tag: 'web', source: 'main' }])
    assert.equal(hello.isPlural, false)

    const bye = findKey(keys, 'greeting.bye')
    assert.deepEqual(tagPair(bye), [{ tag: 'web', source: 'main' }])
  })

  it('adds tag to existing key without duplicating', async () => {
    const apiBefore = await fetch(`${API_BASE}/api/l10n/projects/${projectId}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify({
        keys: [{
          keyName: 'shared.key',
          tags: [{ tag: 'web', source: 'other' }],
        }],
      }),
    })
    assert.ok(apiBefore.ok, `seed failed: ${apiBefore.status}`)

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('shared.key')], { en: [] }, false,
    )

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    // 같은 tag가 다른 source로 이미 있으면 syncer는 태그를 또 붙이지 않는다.
    assert.equal(k.tags.length, 1)
    assert.equal(k.tags[0].tag, 'web')
    assert.equal(k.tags[0].source, 'other')
  })

  it('downloads server translations into local trans entries', async () => {
    const seed = await fetch(`${API_BASE}/api/l10n/projects/${projectId}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEV_TOKEN}` },
      body: JSON.stringify({
        keys: [{
          keyName: 'server.has.translation',
          tags: [{ tag: 'web', source: 'main' }],
          suggestions: [
            { locale: 'en', translation: { other: 'Server EN' }, suggestedBy: 'syncer' },
            { locale: 'ko', translation: { other: '서버 번역' }, suggestedBy: 'syncer' },
          ],
        }],
      }),
    })
    assert.ok(seed.ok, `seed failed: ${seed.status}`)

    const { keys: createdKeys } = await (await fetch(
      `${API_BASE}/api/l10n/projects/${projectId}/keys?includeSuggestions=1`,
      { headers: { Authorization: `Bearer ${DEV_TOKEN}` } },
    )).json() as { keys: { id: string, keyName: string, suggestions: { id: string, locale: string }[] }[] }
    for (const k of createdKeys) {
      for (const s of k.suggestions) {
        const acc = await fetch(`${API_BASE}/api/l10n/suggestions/${s.id}/accept`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${DEV_TOKEN}` },
        })
        assert.ok(acc.ok, `accept failed: ${acc.status}`)
      }
    }

    const localTrans = {
      en: [trans('server.has.translation', { other: '' })],
      ko: [trans('server.has.translation', { other: '' })],
    }
    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('server.has.translation')],
      localTrans, true, // skipUpload — 다운로드만 검증
    )

    assert.equal(localTrans.en[0].messages.other, 'Server EN')
    assert.equal(localTrans.ko[0].messages.other, '서버 번역')
  })

  it('creates a plural key with plural suggestions', async () => {
    const config = buildL10nConfig(projectId!, { source: 'main' })
    const keyEntries = [key('items.count', { isPlural: true })]
    const allTransData = {
      en: [trans('items.count', { one: '{count} item', other: '{count} items' })],
    }

    await syncTransToL10nStorage(config, buildDomainConfig(), 'web', keyEntries, allTransData, false)

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    assert.equal(k.keyName, 'items.count')
    assert.equal(k.isPlural, true)
  })

  it('respects locale-sync-map when uploading suggestions', async () => {
    const config = buildL10nConfig(projectId!, {
      source: 'main',
      localeSyncMap: { 'ko-KR': 'ko' },
    })
    const keyEntries = [key('mapped.key')]
    const allTransData = {
      'en': [trans('mapped.key', { other: 'Mapped' })],
      'ko-KR': [trans('mapped.key', { other: '매핑됨' })],
    }

    await syncTransToL10nStorage(config, buildDomainConfig(), 'web', keyEntries, allTransData, false)

    const { keys: created } = await (await fetch(
      `${API_BASE}/api/l10n/projects/${projectId}/keys?includeSuggestions=1`,
      { headers: { Authorization: `Bearer ${DEV_TOKEN}` } },
    )).json() as { keys: { keyName: string, suggestions: { locale: string }[] }[] }

    const mapped = created.find(x => x.keyName === 'mapped.key')!
    const locales = mapped.suggestions.map(s => s.locale).sort()
    assert.deepEqual(locales, ['en', 'ko'])
  })
})
