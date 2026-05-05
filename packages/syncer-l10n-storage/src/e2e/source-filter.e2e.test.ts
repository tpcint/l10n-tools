import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { L10nStorageApiClient } from '../api-client.js'
import { sourceFilterForL10nStorage } from '../source-filter.js'
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

describe('listKeysToServeByTag (e2e)', () => {
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
    const created = await createProject('source-filter-e2e', ['en', 'ko'], 'en')
    projectId = created.projectId
  })

  after(async () => {
    await deleteProject(projectId)
  })

  it('returns only keys whose tags include the given tag', async () => {
    await seedKeys(projectId!, [
      { keyName: 'web.only', tags: [{ tag: 'web', source: 'main' }] },
      { keyName: 'mobile.only', tags: [{ tag: 'mobile', source: 'main' }] },
      { keyName: 'both', tags: [{ tag: 'web', source: 'main' }, { tag: 'mobile', source: 'main' }] },
    ])

    const keys = await apiClient.listKeysToServeByTag(projectId!, 'web')
    const names = keys.map(k => k.keyName).sort()
    assert.deepEqual(names, ['both', 'web.only'])
  })

  it('with source narrows to keys whose tag entry matches both tag and source in the same item', async () => {
    await seedKeys(projectId!, [
      // 'web' + 'PR-1' 페어가 같은 태그 항목으로 존재
      { keyName: 'pr1.match', tags: [{ tag: 'web', source: 'PR-1' }] },
      // 'web'은 다른 source, 'PR-1'은 다른 tag — 같은 항목 페어가 아님 → 매칭 X
      {
        keyName: 'split.pair',
        tags: [{ tag: 'web', source: 'main' }, { tag: 'mobile', source: 'PR-1' }],
      },
      // 매칭 페어가 있고 다른 페어도 함께 있음 → 매칭
      {
        keyName: 'pair.plus.extras',
        tags: [{ tag: 'web', source: 'PR-1' }, { tag: 'mobile', source: 'main' }],
      },
    ])

    const keys = await apiClient.listKeysToServeByTag(projectId!, 'web', 'PR-1')
    const names = keys.map(k => k.keyName).sort()
    assert.deepEqual(names, ['pair.plus.extras', 'pr1.match'])
  })

  it('returns full tags array on matched keys (not narrowed by filter)', async () => {
    await seedKeys(projectId!, [{
      keyName: 'multi.tag.key',
      tags: [{ tag: 'web', source: 'PR-1' }, { tag: 'mobile', source: 'main' }],
    }])

    const [k] = await apiClient.listKeysToServeByTag(projectId!, 'web', 'PR-1')
    const pairs = k.tags.map(t => ({ tag: t.tag, source: t.source }))
    assert.equal(k.tags.length, 2, 'response should include all tags, not just the filtered pair')
    assert.ok(pairs.some(p => p.tag === 'web' && p.source === 'PR-1'))
    assert.ok(pairs.some(p => p.tag === 'mobile' && p.source === 'main'))
  })

  it('returns an empty list when nothing matches', async () => {
    await seedKeys(projectId!, [
      { keyName: 'mobile.only', tags: [{ tag: 'mobile', source: 'main' }] },
    ])
    const keys = await apiClient.listKeysToServeByTag(projectId!, 'web', 'PR-X')
    assert.deepEqual(keys, [])
  })

  it('paginates correctly when total exceeds API page size', async () => {
    // 페이지네이션 동작 확인용으로 600개 키를 시드 (API 한계가 500)
    const TOTAL = 600
    const seedInput = Array.from({ length: TOTAL }, (_, i) => ({
      keyName: `bulk.${String(i).padStart(4, '0')}`,
      tags: [{ tag: 'web', source: 'PR-bulk' }],
    }))
    // seedKeys 한 번에 너무 많으면 서버가 거부할 수 있어 청크로 나눔
    for (let i = 0; i < seedInput.length; i += 200) {
      await seedKeys(projectId!, seedInput.slice(i, i + 200))
    }

    const keys = await apiClient.listKeysToServeByTag(projectId!, 'web', 'PR-bulk')
    assert.equal(keys.length, TOTAL)
    const names = new Set(keys.map(k => k.keyName))
    assert.ok(names.has('bulk.0000'))
    assert.ok(names.has('bulk.0599'))
  })
})

describe('sourceFilterForL10nStorage (e2e)', () => {
  let projectId: string | undefined

  before(async () => {
    if (!await isL10nApiAvailable()) {
      throw new Error(
        `tpc-agent l10n API not available at ${API_BASE}. `,
      )
    }
    process.env.TPC_AGENT_TOKEN = DEV_TOKEN
  })

  beforeEach(async () => {
    await deleteProject(projectId)
    const created = await createProject('sf-impl-e2e', ['en', 'ko'], 'en')
    projectId = created.projectId
  })

  after(async () => {
    await deleteProject(projectId)
  })

  it('produces snapshots with translations and contexts from metadata', async () => {
    const seeded = await seedKeys(projectId!, [{
      keyName: 'ctx.key',
      tags: [{ tag: 'web', source: 'PR-9' }],
      metadata: [{ tag: 'web', metaKey: 'context', metaValue: JSON.stringify(['ctx1', 'ctx2']) }],
      suggestions: [
        { locale: 'en', translation: { other: 'Hello' }, suggestedBy: 'syncer' },
        { locale: 'ko', translation: { other: '안녕' }, suggestedBy: 'syncer' },
      ],
    }])
    await acceptAllSuggestions(seeded)

    const config = buildL10nConfig(projectId!)
    const snapshots = await sourceFilterForL10nStorage(config, buildDomainConfig(), 'web', 'PR-9')
    assert.equal(snapshots.length, 1)
    const snap = snapshots[0]
    assert.equal(snap.keyName, 'ctx.key')
    assert.deepEqual(snap.contexts.sort(), ['ctx1', 'ctx2'])
    assert.deepEqual(snap.translations.en, { other: 'Hello' })
    assert.deepEqual(snap.translations.ko, { other: '안녕' })
  })

  it('applies localeSyncMap inversion to snapshot translation locales', async () => {
    const seeded = await seedKeys(projectId!, [{
      keyName: 'mapped.key',
      tags: [{ tag: 'web', source: 'PR-1' }],
      suggestions: [
        { locale: 'en', translation: { other: 'Mapped' }, suggestedBy: 'syncer' },
        { locale: 'ko', translation: { other: '매핑됨' }, suggestedBy: 'syncer' },
      ],
    }])
    await acceptAllSuggestions(seeded)

    // 로컬 'ko-KR' ↔ 서버 'ko' 매핑
    const config = buildL10nConfig(projectId!, { localeSyncMap: { 'ko-KR': 'ko' } })
    const snapshots = await sourceFilterForL10nStorage(config, buildDomainConfig(), 'web', 'PR-1')
    assert.equal(snapshots.length, 1)
    const snap = snapshots[0]
    assert.deepEqual(snap.translations['ko-KR'], { other: '매핑됨' })
    assert.equal(snap.translations.ko, undefined)
    assert.deepEqual(snap.translations.en, { other: 'Mapped' })
  })

  it('omits keys outside the requested (tag, source) pair', async () => {
    await seedKeys(projectId!, [
      { keyName: 'in.scope', tags: [{ tag: 'web', source: 'PR-X' }] },
      { keyName: 'other.tag', tags: [{ tag: 'mobile', source: 'PR-X' }] },
      { keyName: 'other.source', tags: [{ tag: 'web', source: 'main' }] },
    ])

    const config = buildL10nConfig(projectId!)
    const snapshots = await sourceFilterForL10nStorage(config, buildDomainConfig(), 'web', 'PR-X')
    const names = snapshots.map(s => s.keyName).sort()
    assert.deepEqual(names, ['in.scope'])
  })
})
