import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DomainConfig, type KeyEntry, L10nConfig, type TransEntry } from 'l10n-tools-core'
import type {
  CreateL10nKeyInput,
  L10nKeyKind,
  L10nKeyToServe,
  L10nSourceTextMatchResult,
  UpdateL10nKeyInput,
} from './api-types.js'
import { buildKeyWarnings, classifyIdKeys, keyWarningsForL10nStorage } from './id-keys.js'
import { buildKeyChanges, buildListedKeyMap, syncTransToL10nStorage, updateTransEntries } from './l10n-storage.js'

function sourceEntry(key: string, opts?: { context?: string | null, isPlural?: boolean }): KeyEntry {
  return {
    key,
    isPlural: opts?.isPlural ?? false,
    context: opts?.context ?? null,
    references: [],
    comments: [],
  }
}

function idEntry(key: string, opts?: { defaultValue?: string | null, draft?: boolean, isPlural?: boolean }): KeyEntry {
  return {
    key,
    isPlural: opts?.isPlural ?? false,
    context: null,
    references: [],
    comments: [],
    idKey: {
      defaultValue: opts?.defaultValue === undefined ? '기본 문구' : opts.defaultValue,
      draft: opts?.draft ?? false,
    },
  }
}

function serverKey(keyName: string, opts?: {
  id?: string,
  keyKind?: L10nKeyKind,
  tags?: { tag: string, source: string }[],
  translations?: { locale: string, translation: Record<string, string> }[],
  isPlural?: boolean,
}): L10nKeyToServe {
  return {
    id: opts?.id ?? `${opts?.keyKind ?? 'source'}:${keyName}`,
    keyName,
    keyKind: opts?.keyKind ?? 'source',
    isPlural: opts?.isPlural ?? false,
    tags: opts?.tags ?? [],
    metadata: [],
    translations: opts?.translations ?? [],
  }
}

function transEntry(key: string, messages: Record<string, string>, context: string | null = null): TransEntry {
  return { key, context, messages, flag: null }
}

describe('buildKeyChanges with id keys', () => {
  it('matches local id keys only with server id keys of the same name', () => {
    const listedKeyMap = buildListedKeyMap([
      serverKey('username', { keyKind: 'source', tags: [{ tag: 'web', source: 'main' }] }),
      serverKey('username', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
    ])

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'main', 'android', [idEntry('username')], {}, listedKeyMap, undefined, undefined, true, 'id',
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 0)
  })

  it('creates an id key even if a source key with the same name is listed', () => {
    const listedKeyMap = buildListedKeyMap([
      serverKey('username', { keyKind: 'source', tags: [{ tag: 'android', source: 'PR-1' }] }),
    ])

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-1', 'android', [sourceEntry('username'), idEntry('username', { defaultValue: '사용자 이름' })], {},
      listedKeyMap, undefined, undefined, false, 'id',
    )

    assert.deepEqual(creatingKeys, [{
      keyName: 'username',
      keyKind: 'id',
      isPlural: false,
      tags: [{ tag: 'android', source: 'PR-1' }],
      metadata: undefined,
      defaultText: { other: '사용자 이름' },
      isDraft: false,
    }])
    assert.equal(updatingKeys.length, 0)
  })

  it('sends draft flag and omits defaultText when the id key has no default value', () => {
    const { creatingKeys } = buildKeyChanges(
      'main', 'android',
      [idEntry('draft_key', { defaultValue: '정책 문구', draft: true }), idEntry('no_default', { defaultValue: null })],
      {}, {}, undefined, undefined, true, 'id',
    )

    const byName = Object.fromEntries(creatingKeys.map(k => [k.keyName, k]))
    assert.deepEqual(byName['draft_key'].defaultText, { other: '정책 문구' })
    assert.equal(byName['draft_key'].isDraft, true)
    assert.equal(byName['no_default'].keyKind, 'id')
    assert.equal('defaultText' in byName['no_default'], false)
    assert.equal(byName['no_default'].isDraft, false)
  })

  it('uses the entry that has a default value when the same id key appears in several modules', () => {
    const entries = [idEntry('shared', { defaultValue: null }), idEntry('shared', { defaultValue: '공유' })]
    const { creatingKeys } = buildKeyChanges('main', 'android', entries, {}, {}, undefined, undefined, true, 'id')

    assert.equal(creatingKeys.length, 1)
    assert.deepEqual(creatingKeys[0].defaultText, { other: '공유' })
  })

  it('does not add id key fields to source keys', () => {
    const { creatingKeys } = buildKeyChanges('main', 'web', [sourceEntry('안녕')], {}, {})

    assert.deepEqual(creatingKeys, [{
      keyName: '안녕',
      isPlural: false,
      tags: [{ tag: 'web', source: 'main' }],
      metadata: undefined,
    }])
  })

  it('attaches local translations to the key of the same kind with local origin', () => {
    const listedKeyMap = buildListedKeyMap([
      serverKey('username', { keyKind: 'source', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('username', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
    ])
    const allTrans = { en: [transEntry('username', { other: 'Username' })] }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'main', 'android', [idEntry('username'), idEntry('new_key')],
      { en: [...allTrans.en, transEntry('new_key', { other: 'New' })] },
      listedKeyMap, undefined, undefined, true, 'id',
    )

    assert.deepEqual(updatingKeys.find(u => u.keyId === 'id:username')?.suggestions, [
      { locale: 'en', translation: { other: 'Username' }, suggestedBy: 'syncer', origin: { type: 'local' } },
    ])
    assert.equal(updatingKeys.some(u => u.keyId === 'source:username' && u.suggestions != null), false)
    assert.deepEqual(creatingKeys[0].suggestions, [
      { locale: 'en', translation: { other: 'New' }, suggestedBy: 'syncer', origin: { type: 'local' } },
    ])
  })

  it('removes default source claims of keys missing locally on full sync of an id tag', () => {
    const listedKeyMap = buildListedKeyMap([
      serverKey('공개', { keyKind: 'source', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('old_key', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }, { tag: 'web', source: 'main' }] }),
      serverKey('pr_key', { keyKind: 'id', tags: [{ tag: 'android', source: 'PR-7' }] }),
      serverKey('kept', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
    ])

    const { updatingKeys } = buildKeyChanges(
      'main', 'android', [idEntry('kept')], {}, listedKeyMap, undefined, undefined, true, 'id',
    )

    const removed: Record<string, UpdateL10nKeyInput['removeTags']> = {}
    for (const u of updatingKeys) removed[u.keyId] = u.removeTags
    assert.deepEqual(removed, {
      'source:공개': [{ tag: 'android', source: 'main' }],
      'id:old_key': [{ tag: 'android', source: 'main' }],
    })
  })

  it('keeps default source claims on full sync of a source tag', () => {
    const listedKeyMap = buildListedKeyMap([
      serverKey('공개', { tags: [{ tag: 'web', source: 'main' }] }),
    ])

    const { updatingKeys } = buildKeyChanges('main', 'web', [], {}, listedKeyMap, undefined, undefined, true, 'source')

    assert.equal(updatingKeys.length, 0)
  })
})

describe('updateTransEntries with id keys', () => {
  it('applies translations of the key with the same kind', () => {
    const listedKeyMap = buildListedKeyMap([
      serverKey('username', { keyKind: 'source', translations: [{ locale: 'en', translation: { other: 'from source key' } }] }),
      serverKey('username', { keyKind: 'id', translations: [{ locale: 'en', translation: { other: 'from id key' } }] }),
    ])
    const allTrans = { en: [transEntry('username', { other: '' })] }

    updateTransEntries([idEntry('username')], allTrans, listedKeyMap)

    assert.deepEqual(allTrans.en[0].messages, { other: 'from id key' })
  })
})

const PROJECT = 'project-1'

function buildConfig(): L10nConfig {
  return new L10nConfig({
    'domains': {
      app: { type: 'android', tag: 'android', locales: ['en'], outputs: [] },
    },
    'sync-target': 'l10n-storage',
    'l10n-storage': { url: 'https://storage.test', projectId: PROJECT, source: 'main' },
  })
}

function buildDomain(): DomainConfig {
  return new DomainConfig({ type: 'android', tag: 'android', locales: ['en'], outputs: [] })
}

type Route = (body: unknown) => Response

describe('syncTransToL10nStorage key mode', () => {
  let requests: { method: string, path: string, body: unknown }[]
  let routes: Record<string, Route>
  const originalToken = process.env.TPC_AGENT_TOKEN

  beforeEach(() => {
    process.env.TPC_AGENT_TOKEN = 'token'
    requests = []
    routes = {}
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      const { pathname } = new URL(url)
      const method = init.method ?? 'GET'
      const body = init.body ? JSON.parse(init.body as string) as unknown : undefined
      requests.push({ method, path: pathname, body })
      const route = routes[`${method} ${pathname}`]
      return route ? route(body) : new Response(null, { status: 204 })
    })
  })

  afterEach(() => {
    mock.restoreAll()
    if (originalToken === undefined) delete process.env.TPC_AGENT_TOKEN
    else process.env.TPC_AGENT_TOKEN = originalToken
  })

  function serveTag(keyMode: 'source' | 'id', keys: L10nKeyToServe[]) {
    routes[`GET /api/l10n/projects/${PROJECT}/tags/android/sync-settings`] = () =>
      Response.json({ tag: 'android', keyMode, minSyncerVersion: keyMode === 'id' ? '1.5.0' : null })
    routes[`GET /api/l10n/projects/${PROJECT}/tags/android/keys-to-serve`] = () =>
      Response.json({ keys, nextCursor: null })
  }

  it('creates id keys on an id tag', async () => {
    serveTag('id', [])

    await syncTransToL10nStorage(buildConfig(), buildDomain(), 'android',
      [idEntry('publish_button', { defaultValue: '공개' })], {}, false, { keyMode: 'id' })

    const create = requests.find(r => r.method === 'POST')
    assert.ok(create)
    assert.deepEqual((create.body as { keys: CreateL10nKeyInput[] }).keys, [{
      keyName: 'publish_button',
      keyKind: 'id',
      isPlural: false,
      tags: [{ tag: 'android', source: 'main' }],
      defaultText: { other: '공개' },
      isDraft: false,
    }])
  })

  it('fails without uploading when keys were extracted with another key mode', async () => {
    serveTag('id', [])

    await assert.rejects(
      syncTransToL10nStorage(buildConfig(), buildDomain(), 'android', [sourceEntry('공개')], {}, false),
      /tag android uses keyMode=id, but keys were extracted with keyMode=source/,
    )
    assert.deepEqual(requests.map(r => r.method), ['GET'])
  })

  it('treats a server without sync settings as a source tag', async () => {
    routes[`GET /api/l10n/projects/${PROJECT}/tags/android/sync-settings`] = () => new Response('not found', { status: 404 })
    routes[`GET /api/l10n/projects/${PROJECT}/tags/android/keys-to-serve`] = () => Response.json({ keys: [], nextCursor: null })

    await syncTransToL10nStorage(buildConfig(), buildDomain(), 'android', [sourceEntry('공개')], {}, false)

    assert.deepEqual(requests.map(r => r.method), ['GET', 'GET', 'POST'])
  })

  it('fails with the server message when the syncer is too old', async () => {
    const desc = '태그 android 는 공용 키 방식이라 l10n-tools-syncer-l10n-storage 9.0.0 이상이 필요합니다 (요청 버전: 1.4.7)'
    routes[`GET /api/l10n/projects/${PROJECT}/tags/android/sync-settings`] = () =>
      Response.json({ tag: 'android', keyMode: 'id', minSyncerVersion: '9.0.0' })
    routes[`GET /api/l10n/projects/${PROJECT}/tags/android/keys-to-serve`] = () => Response.json({
      status: 426,
      name: 'L10nSyncerUpgradeRequired',
      desc,
      descDetail: null,
      payload: JSON.stringify({ tag: 'android', keyMode: 'id', minSyncerVersion: '9.0.0', requestVersion: '1.4.7' }),
    }, { status: 426 })

    await assert.rejects(
      syncTransToL10nStorage(buildConfig(), buildDomain(), 'android', [idEntry('publish_button')], {}, false, { keyMode: 'id' }),
      (err: Error) => err.message === desc,
    )
  })

  it('warns about renamed and reusable id keys of a PR', async () => {
    serveTag('id', [
      serverKey('publish_button', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('kept', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('publish_cta', { keyKind: 'id', tags: [{ tag: 'android', source: 'PR-3' }] }),
    ])
    let lookup: unknown
    routes[`POST /api/l10n/projects/${PROJECT}/keys/by-source-texts`] = body => {
      lookup = body
      return Response.json({
        results: [{
          text: { other: '공개' },
          keys: [
            { id: '1', keyName: 'publish_button', keyKind: 'id', isPlural: false, isDraft: false, sourceStatus: 'confirmed', tags: [] },
            { id: '2', keyName: 'publish_cta', keyKind: 'id', isPlural: false, isDraft: false, sourceStatus: 'confirmed', tags: [] },
            { id: '3', keyName: 'web_publish', keyKind: 'id', isPlural: false, isDraft: false, sourceStatus: 'confirmed', tags: [] },
            { id: '4', keyName: '공개', keyKind: 'source', isPlural: false, isDraft: false, sourceStatus: 'keyName', tags: [] },
          ],
        }],
      })
    }

    const warnings = await keyWarningsForL10nStorage(buildConfig(), buildDomain(), 'android', 'PR-3',
      [idEntry('kept'), idEntry('publish_cta', { defaultValue: '공개' })])

    assert.deepEqual(lookup, { texts: [{ other: '공개' }], keyKind: 'id', isPlural: false })
    assert.deepEqual(warnings.map(w => [w.kind, w.keyName, w.relatedKeyNames]), [
      ['renamed-key', 'publish_cta', ['publish_button']],
      ['reusable-key', 'publish_cta', ['web_publish']],
    ])
  })

  it('does not contact the server for warnings without id keys or on the default source', async () => {
    assert.deepEqual(await keyWarningsForL10nStorage(buildConfig(), buildDomain(), 'android', 'PR-3', [sourceEntry('공개')]), [])
    assert.deepEqual(await keyWarningsForL10nStorage(buildConfig(), buildDomain(), 'android', 'main', [idEntry('a')]), [])
    assert.equal(requests.length, 0)
  })

  it('skips warnings when the lookup fails', async () => {
    serveTag('id', [])
    routes[`POST /api/l10n/projects/${PROJECT}/keys/by-source-texts`] = () => new Response('not implemented', { status: 501 })

    const warnings = await keyWarningsForL10nStorage(buildConfig(), buildDomain(), 'android', 'PR-3',
      [idEntry('new_key', { defaultValue: '새 문구' })])

    assert.deepEqual(warnings, [])
  })
})

describe('classifyIdKeys', () => {
  it('excludes keys already claimed by the default source, drafts, plurals and keys without default value', () => {
    const listed = [
      serverKey('existing', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('pr_only', { keyKind: 'id', tags: [{ tag: 'android', source: 'PR-3' }] }),
      serverKey('removed', { keyKind: 'id', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('removed_source', { keyKind: 'source', tags: [{ tag: 'android', source: 'main' }] }),
      serverKey('other_pr', { keyKind: 'id', tags: [{ tag: 'android', source: 'PR-9' }] }),
    ]
    const entries = [
      idEntry('existing', { defaultValue: 'a' }),
      idEntry('pr_only', { defaultValue: 'b' }),
      idEntry('brand_new', { defaultValue: 'c' }),
      idEntry('draft', { defaultValue: 'd', draft: true }),
      idEntry('plural', { defaultValue: 'e', isPlural: true }),
      idEntry('no_default', { defaultValue: null }),
    ]

    const { newKeys, removedKeyNames } = classifyIdKeys('android', 'main', entries, listed)

    assert.deepEqual(newKeys, [
      { keyName: 'pr_only', defaultValue: 'b' },
      { keyName: 'brand_new', defaultValue: 'c' },
    ])
    assert.deepEqual([...removedKeyNames], ['removed'])
  })
})

describe('buildKeyWarnings', () => {
  it('returns no warning when only the new key itself matches', () => {
    const matches: L10nSourceTextMatchResult[] = [{
      text: { other: '공개' },
      keys: [{ id: '1', keyName: 'publish', keyKind: 'id', isPlural: false, isDraft: false, sourceStatus: 'confirmed', tags: [] }],
    }]

    assert.deepEqual(buildKeyWarnings([{ keyName: 'publish', defaultValue: '공개' }], new Set(), matches), [])
  })
})
