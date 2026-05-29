import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyEntry, TransEntry } from 'l10n-tools-core'
import { L10nStorageApiClient } from '../api-client.js'
import type { L10nKeyToServe } from '../api-types.js'
import { syncTransToL10nStorage } from '../l10n-storage.js'
import {
  acceptAllSuggestions,
  API_BASE,
  buildDomainConfig,
  buildL10nConfig,
  createProject,
  deleteProject,
  DEV_TOKEN,
  isL10nApiAvailable,
  seedKeys,
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

  it('addTags is silently skipped when another source already owns the (key, tag)', async () => {
    // PR 1161: (key_id, tag) PK이므로 한 (key, tag)는 한 source만 점유. main이 sync에서 자기
    // (web, main) claim을 시도해도 server가 ON CONFLICT DO NOTHING으로 silent skip하고 기존 source가
    // 그대로 유지된다. syncer는 이 동작에 의존해 idempotent하게 addTags를 보낸다.
    await seedKeys(projectId!, [{
      keyName: 'shared.key',
      tags: [{ tag: 'web', source: 'other' }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('shared.key')], { en: [] }, false,
    )

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    assert.deepEqual(
      k.tags.map(t => ({ tag: t.tag, source: t.source })),
      [{ tag: 'web', source: 'other' }],
    )
  })

  it('downloads server translations into local trans entries', async () => {
    const seeded = await seedKeys(projectId!, [{
      keyName: 'server.has.translation',
      tags: [{ tag: 'web', source: 'main' }],
      suggestions: [
        { locale: 'en', translation: { other: 'Server EN' }, suggestedBy: 'syncer' },
        { locale: 'ko', translation: { other: '서버 번역' }, suggestedBy: 'syncer' },
      ],
    }])
    await acceptAllSuggestions(seeded)

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

  it('removes context from metadata when local entry no longer has it', async () => {
    await seedKeys(projectId!, [{
      keyName: 'ctx.key',
      tags: [{ tag: 'web', source: 'main' }],
      metadata: [{ tag: 'web', metaKey: 'context', metaValue: JSON.stringify(['ctx-A', 'ctx-B']) }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    // ctx-A만 로컬에 남고 ctx-B는 사라진 상태
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('ctx.key', { context: 'ctx-A' })], {}, false,
    )

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    const ctxMeta = k.metadata.find(m => m.tag === 'web' && m.metaKey === 'context')
    assert.deepEqual(JSON.parse(ctxMeta!.metaValue), ['ctx-A'])
    assert.equal(k.tags.length, 1, 'tag remains because ctx-A still belongs to main')
  })

  it('removes the tag and empties context when all contexts are gone from local', async () => {
    // 전체 sync가 로컬에 없는 마지막 context까지 다 빼고 나면 (tag, *)를 source-omitted로 unclaim한다.
    // 단일-source 모델이라 "다른 source 보존" 시나리오는 정의상 존재하지 않는다.
    await seedKeys(projectId!, [{
      keyName: 'ctx.gone.key',
      tags: [{ tag: 'web', source: 'main' }],
      metadata: [{ tag: 'web', metaKey: 'context', metaValue: JSON.stringify(['ctx-only']) }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [], {}, false,
    )

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    assert.deepEqual(k.tags.map(t => ({ tag: t.tag, source: t.source })), [])
    const ctxMeta = k.metadata.find(m => m.tag === 'web' && m.metaKey === 'context')
    assert.deepEqual(JSON.parse(ctxMeta!.metaValue), [])
  })

  it('attaches additionalTags + globalMetadata + tagMetadata when creating keys', async () => {
    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('extra.key')], { en: [trans('extra.key', { other: 'X' })] }, false,
      {
        additionalTags: ['featured'],
        globalMetadata: { team: 'l10n' },
        tagMetadata: { repository: 'likey-web' },
      },
    )

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    const tagPairs = k.tags.map(t => ({ tag: t.tag, source: t.source }))
    assert.ok(tagPairs.some(t => t.tag === 'web' && t.source === 'main'))
    assert.ok(tagPairs.some(t => t.tag === 'featured' && t.source === 'main'))
    assert.ok(k.metadata.some(m => m.tag === null && m.metaKey === 'team' && m.metaValue === 'l10n'))
    assert.ok(k.metadata.some(m => m.tag === 'web' && m.metaKey === 'repository' && m.metaValue === 'likey-web'))
  })

  it('refreshes references metadata on every sync', async () => {
    await seedKeys(projectId!, [{
      keyName: 'ref.key',
      tags: [{ tag: 'web', source: 'main' }],
      metadata: [{
        tag: 'web',
        metaKey: 'references',
        metaValue: JSON.stringify([{ file: 'old.ts' }]),
      }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    const keyEntry: KeyEntry = {
      key: 'ref.key',
      isPlural: false,
      context: null,
      references: [{ file: 'src/new.ts', loc: '10:5' }],
      comments: [],
    }
    await syncTransToL10nStorage(config, buildDomainConfig(), 'web', [keyEntry], {}, false)

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    const refMeta = k.metadata.find(m => m.tag === 'web' && m.metaKey === 'references')
    assert.deepEqual(JSON.parse(refMeta!.metaValue), [{ file: 'src/new.ts', loc: '10:5' }])
  })

  it('downloads plural translations as a full message object', async () => {
    const seeded = await seedKeys(projectId!, [{
      keyName: 'plural.download',
      isPlural: true,
      tags: [{ tag: 'web', source: 'main' }],
      suggestions: [
        { locale: 'en', translation: { one: '{n} item', other: '{n} items' }, suggestedBy: 'syncer' },
      ],
    }])
    await acceptAllSuggestions(seeded)

    const localTrans = {
      en: [trans('plural.download', {})],
    }
    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('plural.download', { isPlural: true })],
      localTrans, true,
    )

    assert.equal(localTrans.en[0].messages.one, '{n} item')
    assert.equal(localTrans.en[0].messages.other, '{n} items')
  })

  it('clears flag on local trans entry when server translation is applied', async () => {
    const seeded = await seedKeys(projectId!, [{
      keyName: 'flagged.key',
      tags: [{ tag: 'web', source: 'main' }],
      suggestions: [
        { locale: 'en', translation: { other: 'Authoritative' }, suggestedBy: 'syncer' },
      ],
    }])
    await acceptAllSuggestions(seeded)

    const localTrans = {
      en: [trans('flagged.key', { other: 'Authoritative' }) as TransEntry],
    }
    localTrans.en[0].flag = 'fuzzy'

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web', [key('flagged.key')], localTrans, true,
    )

    assert.equal(localTrans.en[0].flag, null)
  })

  it('PR source claims an existing key first introduced under this tag, no context (수정 A)', async () => {
    // 다른 repo(web)가 만든 키를 web4가 PR에서 처음 사용. context 없는 도메인이라 contextAdded는
    // 영영 false지만, web4가 이 키를 처음 다루므로 (web4, PR-1)을 claim해야 한다.
    await seedKeys(projectId!, [{
      keyName: '취소',
      tags: [{ tag: 'web', source: 'main' }],
    }])

    // configSource='main', options.source='PR-1' → 비전체 sync
    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web4', [key('취소')], {}, false, { source: 'PR-1' },
    )

    const served = await apiClient.listKeysToServeByTag(projectId!, 'web4', 'PR-1')
    assert.deepEqual(served.map(k => k.keyName), ['취소'])

    // 기존 (web, main) 태그는 보존되고 (web4, PR-1)이 추가됨
    const [k] = await apiClient.listAllKeysToServe(projectId!)
    const pairs = k.tags.map(t => ({ tag: t.tag, source: t.source }))
    assert.ok(pairs.some(p => p.tag === 'web' && p.source === 'main'))
    assert.ok(pairs.some(p => p.tag === 'web4' && p.source === 'PR-1'))
  })

  it('PR source does NOT claim a key this tag already owns (수정 A 음성, no flood)', async () => {
    // "불러오는 중..." 유형: main이 이미 (web4, main)으로 소유. PR이 추출에 포함했다고 claim하면 안 됨.
    await seedKeys(projectId!, [{
      keyName: '불러오는 중...',
      tags: [{ tag: 'web4', source: 'main' }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web4', [key('불러오는 중...')], {}, false, { source: 'PR-1' },
    )

    const served = await apiClient.listKeysToServeByTag(projectId!, 'web4', 'PR-1')
    assert.deepEqual(served.map(k => k.keyName), [])
  })

  it('PR source self-cleans its (tag, source) claim when the key disappears from local', async () => {
    // PR이 도중에 추가했다가 도중에 제거한 키 — 자기 (web4, PR-1) claim을 즉시 정리한다.
    // 단일-source 모델이라 main scope와 동시 공존하는 시나리오는 없다; 키는 PR-1 unclaim 후 orphan이 되고
    // 데이터(context 포함)는 보존되어 누가 다시 claim하면 부활한다.
    await seedKeys(projectId!, [{
      keyName: 'orphan.key',
      tags: [{ tag: 'web4', source: 'PR-1' }],
      metadata: [{ tag: 'web4', metaKey: 'context', metaValue: JSON.stringify(['shared']) }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'web4', [], {}, false, { source: 'PR-1' },
    )

    // PR-1 scope는 비었고 key는 orphan으로 보존
    const prScope = await apiClient.listKeysToServeByTag(projectId!, 'web4', 'PR-1')
    assert.deepEqual(prScope.map(k => k.keyName), [])

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    assert.equal(k.keyName, 'orphan.key')
    assert.deepEqual(k.tags.map(t => ({ tag: t.tag, source: t.source })), [])
    // context는 데이터 보존 — 재claim 시 부활
    const ctxMeta = k.metadata.find(m => m.tag === 'web4' && m.metaKey === 'context')
    assert.deepEqual(JSON.parse(ctxMeta!.metaValue), ['shared'])
  })

  it('full sync unclaims (tag) when key is gone locally (context-less)', async () => {
    // context-less 도메인에서 로컬에 없는 키는 즉시 source-omitted removeTags로 (tag) unclaim한다.
    // 단일-source 모델이라 (tag) PK당 source는 하나뿐 — source 생략은 그 한 row를 깨끗이 제거한다.
    await seedKeys(projectId!, [{
      keyName: 'gone.key',
      tags: [{ tag: 'web4', source: 'main' }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(config, buildDomainConfig(), 'web4', [], {}, false)

    // 키는 orphan으로 보존(데이터 유지, 태그만 제거)
    const [k] = await apiClient.listAllKeysToServe(projectId!)
    assert.equal(k.keyName, 'gone.key')
    assert.deepEqual(k.tags.map(t => ({ tag: t.tag, source: t.source })), [])

    // tag 필터 serve는 orphan을 자연 제외
    const served = await apiClient.listKeysToServeByTag(projectId!, 'web4')
    assert.deepEqual(served.map(k => k.keyName), [])
  })

  it('full sync removes all orphan contexts and then unclaims (tag) (context-ful, multi-context)', async () => {
    // Android 같은 context-ful 도메인에서 서버 context 여러 개가 로컬에서 모두 사라진 케이스.
    // 모든 orphan context를 빠짐없이 제거해야 한다 — Pass 1에서 baseMetadata를 누적하지 않으면
    // pushSetMetadata replace 때문에 마지막 iteration만 살아남는 회귀가 있었다. 모든 context가
    // 빠지면 그 다음 (tag) source-omitted unclaim까지 동일 PUT으로 보낸다.
    await seedKeys(projectId!, [{
      keyName: '취소',
      tags: [{ tag: 'android-likey', source: 'main' }],
      metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a', 'b']) }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(config, buildDomainConfig(), 'android-likey', [], {}, false)

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    assert.equal(k.keyName, '취소')
    assert.deepEqual(k.tags.map(t => ({ tag: t.tag, source: t.source })), [])
    const ctxMeta = k.metadata.find(m => m.tag === 'android-likey' && m.metaKey === 'context')
    assert.deepEqual(JSON.parse(ctxMeta!.metaValue), [])
  })

  it('full sync removes only missing contexts and preserves the tag when others remain', async () => {
    // 로컬에 일부 context가 남아 있으면 빠진 context만 제거하고 (tag, source)는 그대로 둔다.
    // context가 줄어들 뿐 키는 여전히 코드에서 사용되므로 unclaim 대상이 아니다.
    await seedKeys(projectId!, [{
      keyName: '취소',
      tags: [{ tag: 'android-likey', source: 'main' }],
      metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a', 'b']) }],
    }])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(
      config, buildDomainConfig(), 'android-likey',
      [key('취소', { context: 'a' })], {}, false,
    )

    const [k] = await apiClient.listAllKeysToServe(projectId!)
    // 태그는 보존
    assert.deepEqual(
      k.tags.map(t => ({ tag: t.tag, source: t.source })),
      [{ tag: 'android-likey', source: 'main' }],
    )
    // 'b'만 제거되고 'a'는 남음
    const ctxMeta = k.metadata.find(m => m.tag === 'android-likey' && m.metaKey === 'context')
    assert.deepEqual(JSON.parse(ctxMeta!.metaValue), ['a'])
  })

  it('tag-filtered fetch isolates cleanup — never touches keys tagged with a different tag', async () => {
    // sync는 자신이 다루는 태그에만 영향을 준다. 같은 프로젝트에 다른 태그(web)로만 존재하는 키는
    // tag-filtered fetch에서 보이지 않으므로 web4 sync의 Pass 1 cleanup이 절대 건드릴 수 없다.
    await seedKeys(projectId!, [
      { keyName: 'only.web4', tags: [{ tag: 'web4', source: 'main' }] },
      { keyName: 'only.web', tags: [{ tag: 'web', source: 'main' }] },
    ])

    const config = buildL10nConfig(projectId!, { source: 'main' })
    await syncTransToL10nStorage(config, buildDomainConfig(), 'web4', [], {}, false)

    const all = await apiClient.listAllKeysToServe(projectId!)
    const w4 = all.find(k => k.keyName === 'only.web4')!
    const w = all.find(k => k.keyName === 'only.web')!

    // only.web4는 전체 sync의 (web4, *) unclaim으로 orphan이 된다
    assert.deepEqual(w4.tags.map(t => ({ tag: t.tag, source: t.source })), [])
    // only.web은 다른 태그라 완전 보존
    assert.deepEqual(
      w.tags.map(t => ({ tag: t.tag, source: t.source })),
      [{ tag: 'web', source: 'main' }],
    )
  })
})
