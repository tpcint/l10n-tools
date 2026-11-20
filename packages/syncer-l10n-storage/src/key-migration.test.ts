import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { DomainConfig, type KeyEntry, L10nConfig } from 'l10n-tools-core'
import type { L10nKeyMigrationError, L10nKeyMigrationResponse, L10nKeyMigrationRollbackResponse } from './api-types.js'
import {
  buildKeyMigrationItems,
  formatKeyMigrationResponse,
  formatKeyMigrationRollbackResponse,
  migrateKeysInL10nStorage,
  rollbackKeyMigrationInL10nStorage,
} from './key-migration.js'

const APP_XML = 'app/src/main/res/values/strings.xml'
const PRESENTATION_XML = 'presentation/src/main/res/values/strings.xml'

function sourceEntry(context: string, key: string, file: string, loc: string, isPlural = false): KeyEntry {
  return { context, key, isPlural, references: [{ file, loc }], comments: [] }
}

function idEntry(key: string, refs: [string, string][], isPlural = false): KeyEntry {
  return {
    context: null,
    key,
    isPlural,
    references: refs.map(([file, loc]) => ({ file, loc })),
    comments: [],
    idKey: { defaultValue: null, draft: false },
  }
}

describe('buildKeyMigrationItems', () => {
  it('pairs each resource with the source key it uses by reference', () => {
    const items = buildKeyMigrationItems([
      sourceEntry('publish_button', '공개', APP_XML, '3'),
      sourceEntry('publish_cta', '공개', APP_XML, '4'),
      sourceEntry('live_cast_chat_deleted_by_admin', '관리자가 삭제한 메시지입니다.', APP_XML, '5'),
      sourceEntry('presentation:live_cast_chat_deleted_by_admin', '관리자가 삭제한 메시지입니다.', PRESENTATION_XML, '3'),
      sourceEntry('presentation:confirm_publish', '공개', PRESENTATION_XML, '4'),
      sourceEntry('left_days', '%d일 남음', APP_XML, '6', true),
    ], [
      idEntry('publish_button', [[APP_XML, '3']]),
      idEntry('publish_cta', [[APP_XML, '4']]),
      idEntry('live_cast_chat_deleted_by_admin', [[APP_XML, '5'], [PRESENTATION_XML, '3']]),
      // l10n:key 로 리소스 이름과 다른 공용 키를 지정한 리소스
      idEntry('confirm_publish_dialog', [[PRESENTATION_XML, '4']]),
      idEntry('left_days', [[APP_XML, '6']], true),
    ])

    assert.deepEqual(items, [
      { idKeyName: 'confirm_publish_dialog', sourceKeyName: '공개', contexts: ['presentation:confirm_publish'] },
      { idKeyName: 'left_days', sourceKeyName: '%d일 남음', contexts: ['left_days'] },
      {
        idKeyName: 'live_cast_chat_deleted_by_admin',
        sourceKeyName: '관리자가 삭제한 메시지입니다.',
        contexts: ['live_cast_chat_deleted_by_admin'],
      },
      {
        idKeyName: 'live_cast_chat_deleted_by_admin',
        sourceKeyName: '관리자가 삭제한 메시지입니다.',
        contexts: ['presentation:live_cast_chat_deleted_by_admin'],
      },
      { idKeyName: 'publish_button', sourceKeyName: '공개', contexts: ['publish_button'] },
      { idKeyName: 'publish_cta', sourceKeyName: '공개', contexts: ['publish_cta'] },
    ])
  })

  it('does not migrate resources that stay source keys in id mode', () => {
    const items = buildKeyMigrationItems([
      sourceEntry('publish_button', '공개', APP_XML, '3'),
      sourceEntry('legacy', '예전 문구', APP_XML, '4'),
    ], [
      idEntry('publish_button', [[APP_XML, '3']]),
      { ...sourceEntry('legacy', '예전 문구', APP_XML, '4') },
    ])

    assert.deepEqual(items.map(item => item.idKeyName), ['publish_button'])
  })

  it('throws when a source key has no id-mode counterpart', () => {
    assert.throws(() => buildKeyMigrationItems([
      sourceEntry('publish_button', '공개', APP_XML, '3'),
    ], []), /no id-mode key at app\/src\/main\/res\/values\/strings\.xml:3/)
  })

  it('throws when an id key has no source-mode counterpart', () => {
    assert.throws(() => buildKeyMigrationItems([], [
      idEntry('publish_button', [[APP_XML, '3']]),
    ]), /no source key at .*:3 for id key "publish_button"/)
  })

  it('throws when the plural form differs between the two extractions', () => {
    assert.throws(() => buildKeyMigrationItems([
      sourceEntry('left_days', '%d일 남음', APP_XML, '6', true),
    ], [
      idEntry('left_days', [[APP_XML, '6']], false),
    ]), /plural in source mode but not plural in id mode/)
  })

  it('throws when references cannot tell resources apart', () => {
    assert.throws(() => buildKeyMigrationItems([
      { context: 'a', key: '가', isPlural: false, references: [{ file: APP_XML }], comments: [] },
      { context: 'b', key: '나', isPlural: false, references: [{ file: APP_XML }], comments: [] },
    ], []), /has two source keys "가" and "나"/)
  })
})

function migrationResponse(overrides: Partial<L10nKeyMigrationResponse> = {}): L10nKeyMigrationResponse {
  return {
    migrationId: null,
    dryRun: true,
    summary: {
      items: 1,
      idKeysCreated: 1,
      idKeysReused: 0,
      translationsCopied: 2,
      suggestionsCopied: 0,
      conflicts: 0,
      tagsMoved: 1,
    },
    items: [{
      idKeyName: 'publish_button',
      idKeyId: null,
      idKeyCreated: true,
      sourceKeyId: 'source-1',
      sourceKeyName: '공개',
      translationsCopied: ['ko', 'en'],
      suggestionsCopied: [],
      conflicts: [],
      tagMoved: true,
      contextsMoved: ['publish_button'],
      warnings: [],
    }],
    errors: [],
    tagSettings: {
      before: { tag: 'android', keyMode: 'source', minSyncerVersion: null },
      after: { tag: 'android', keyMode: 'id', minSyncerVersion: '1.6.0' },
    },
    rollbackPlan: null,
    ...overrides,
  }
}

describe('formatKeyMigrationResponse', () => {
  it('prints the summary, tag settings change and how to roll back for a dry-run', () => {
    const lines = formatKeyMigrationResponse(migrationResponse(), 'project-1')

    assert.deepEqual(lines.map(line => line.level), ['info', 'info', 'info'])
    assert.match(lines[0].message, /^\[dry-run\] 1 items: 1 id keys created, 0 reused, 2 translations and 0 suggestions copied/)
    assert.equal(lines[1].message,
      '[dry-run] tag android: keyMode=source, minSyncerVersion=null -> keyMode=id, minSyncerVersion=1.6.0')
    assert.match(lines[2].message, /'l10n --project-id project-1 migrate-keys --rollback <migrationId>'.*back to keyMode=source, minSyncerVersion=null/)
  })

  it('prints errors, conflicts and item warnings', () => {
    const error: L10nKeyMigrationError = {
      index: 0,
      idKeyName: 'publish_button',
      sourceKeyName: '공개',
      reason: 'source-key-not-found',
      message: 'source key not found',
    }
    const response = migrationResponse({ errors: [error] })
    response.items[0].conflicts = [{ locale: 'en', status: 'confirmed', existing: { other: 'Publish' }, incoming: { other: 'Open' } }]
    response.items[0].warnings = ['source key is claimed by PR-12']

    const lines = formatKeyMigrationResponse(response, 'project-1').filter(line => line.level !== 'info')

    assert.deepEqual(lines, [
      { level: 'error', message: '[source-key-not-found] items[0] publish_button <- "공개": source key not found' },
      { level: 'error', message: 'source-key-not-found: run migrate-keys on the default branch after its sync has uploaded every resource' },
      {
        level: 'warn',
        message: 'conflict: publish_button <- "공개" [en confirmed] keeps {"other":"Publish"}, not copying {"other":"Open"}',
      },
      { level: 'warn', message: 'publish_button <- "공개": source key is claimed by PR-12' },
    ])
  })

  it('prints the stored rollback plan of an applied migration', () => {
    const lines = formatKeyMigrationResponse(migrationResponse({
      migrationId: 'mig-1',
      dryRun: false,
      rollbackPlan: {
        migrationId: 'mig-1',
        tag: 'android',
        untag: [{ keyId: 'id-1', source: 'main' }],
        retag: [{ keyId: 'source-1', source: 'main' }],
        restoreMetadata: [{ keyId: 'source-1', metaKey: 'context', metaValue: '["publish_button"]' }],
        tagSettings: { tag: 'android', keyMode: 'source', minSyncerVersion: null },
      },
    }), 'clone-project')

    assert.deepEqual(lines.slice(2).map(line => line.message), [
      'migration mig-1 applied. rollback plan: untag 1 id keys, retag 1 source keys, restore 1 metadata, '
      + 'tag settings back to keyMode=source, minSyncerVersion=null',
      'to roll back: l10n --project-id clone-project migrate-keys --rollback mig-1',
    ])
  })
})

describe('formatKeyMigrationRollbackResponse', () => {
  it('prints counts, tag settings change and skipped items', () => {
    const response: L10nKeyMigrationRollbackResponse = {
      dryRun: false,
      migrationId: 'mig-1',
      untagged: 3,
      retagged: 2,
      metadataRestored: 4,
      tagSettings: {
        before: { tag: 'android', keyMode: 'id', minSyncerVersion: '1.6.0' },
        after: { tag: 'android', keyMode: 'source', minSyncerVersion: null },
      },
      warnings: ['key id-9 is already untagged'],
    }

    assert.deepEqual(formatKeyMigrationRollbackResponse(response), [
      { level: 'info', message: 'rollback mig-1: 3 id keys untagged, 2 source keys retagged, 4 metadata restored' },
      { level: 'info', message: 'tag android: keyMode=id, minSyncerVersion=1.6.0 -> keyMode=source, minSyncerVersion=null' },
      { level: 'warn', message: 'key id-9 is already untagged' },
    ])
  })
})

const PROJECT = 'project-1'

function buildConfig(): L10nConfig {
  return new L10nConfig({
    'domains': {
      app: { type: 'android', tag: 'android', locales: ['en'], outputs: [] },
    },
    'sync-target': 'l10n-storage',
    'l10n-storage': { url: 'https://storage.test', projectId: PROJECT, source: 'release' },
  })
}

function buildDomain(): DomainConfig {
  return new DomainConfig({ type: 'android', tag: 'android', locales: ['en'], outputs: [] })
}

describe('key migration requests', () => {
  let requests: { method: string, path: string, body: unknown }[]
  let respond: (body: unknown) => Response
  const originalToken = process.env.TPC_AGENT_TOKEN

  beforeEach(() => {
    process.env.TPC_AGENT_TOKEN = 'token'
    requests = []
    respond = () => Response.json(migrationResponse())
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) as unknown : undefined
      requests.push({ method: init.method ?? 'GET', path: new URL(url).pathname, body })
      return respond(body)
    })
  })

  afterEach(() => {
    mock.restoreAll()
    if (originalToken === undefined) delete process.env.TPC_AGENT_TOKEN
    else process.env.TPC_AGENT_TOKEN = originalToken
  })

  const sourceEntries = [sourceEntry('publish_button', '공개', APP_XML, '3')]
  const idEntries = [idEntry('publish_button', [[APP_XML, '3']])]

  it('sends the plan with the configured default source and tag settings', async () => {
    const result = await migrateKeysInL10nStorage(buildConfig(), buildDomain(), 'android', sourceEntries, idEntries,
      { dryRun: true, minSyncerVersion: '1.6.0' })

    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'POST')
    assert.equal(requests[0].path, `/api/l10n/projects/${PROJECT}/key-migrations`)
    assert.deepEqual(requests[0].body, {
      dryRun: true,
      tag: 'android',
      source: 'release',
      items: [{ idKeyName: 'publish_button', sourceKeyName: '공개', contexts: ['publish_button'] }],
      tagSettings: { keyMode: 'id', minSyncerVersion: '1.6.0' },
    })
    assert.equal(result.migrationId, null)
    assert.equal(result.errorCount, 0)
    assert.deepEqual(result.response, migrationResponse())
  })

  it('counts dry-run errors', async () => {
    respond = () => Response.json(migrationResponse({
      errors: [{ index: 0, idKeyName: 'publish_button', sourceKeyName: '공개', reason: 'plural-mismatch', message: 'm' }],
    }))

    const result = await migrateKeysInL10nStorage(buildConfig(), buildDomain(), 'android', sourceEntries, idEntries,
      { dryRun: true, minSyncerVersion: '1.6.0' })

    assert.equal(result.errorCount, 1)
  })

  it('returns the errors of a rejected migration', async () => {
    const errors: L10nKeyMigrationError[] = [
      { index: 0, idKeyName: 'publish_button', sourceKeyName: '공개', reason: 'id-key-tag-conflict', message: 'm' },
    ]
    respond = () => Response.json({
      status: 400,
      name: 'L10nKeyMigrationInvalid',
      desc: '이관 계획에 오류가 있습니다',
      descDetail: null,
      payload: JSON.stringify({ errors }),
    }, { status: 400 })

    const result = await migrateKeysInL10nStorage(buildConfig(), buildDomain(), 'android', sourceEntries, idEntries,
      { dryRun: false, minSyncerVersion: '1.6.0' })

    assert.deepEqual(result, { migrationId: null, errorCount: 1, response: { errors } })
  })

  it('does not treat other 400 responses as plan errors', async () => {
    respond = () => Response.json({ status: 400, name: 'ValidationError', desc: 'bad', descDetail: null, payload: null }, { status: 400 })

    await assert.rejects(
      migrateKeysInL10nStorage(buildConfig(), buildDomain(), 'android', sourceEntries, idEntries,
        { dryRun: false, minSyncerVersion: '1.6.0' }),
      /L10n Storage API error: 400/,
    )
  })

  it('rejects a minimum syncer version that is not semver without calling the server', async () => {
    await assert.rejects(
      migrateKeysInL10nStorage(buildConfig(), buildDomain(), 'android', sourceEntries, idEntries,
        { dryRun: true, minSyncerVersion: 'latest' }),
      /must be semver/,
    )
    assert.equal(requests.length, 0)
  })

  it('fails without calling the server when no resource uses an id key', async () => {
    const result = await migrateKeysInL10nStorage(buildConfig(), buildDomain(), 'android', sourceEntries,
      [{ ...sourceEntries[0] }], { dryRun: true, minSyncerVersion: '1.6.0' })

    assert.deepEqual(result, { migrationId: null, errorCount: 1, response: null })
    assert.equal(requests.length, 0)
  })

  it('rolls back by migration id', async () => {
    const response: L10nKeyMigrationRollbackResponse = {
      dryRun: true,
      migrationId: 'mig-1',
      untagged: 1,
      retagged: 1,
      metadataRestored: 0,
      tagSettings: {
        before: { tag: 'android', keyMode: 'id', minSyncerVersion: '1.6.0' },
        after: { tag: 'android', keyMode: 'source', minSyncerVersion: null },
      },
      warnings: [],
    }
    respond = () => Response.json(response)

    const result = await rollbackKeyMigrationInL10nStorage(buildConfig(), 'mig-1', { dryRun: true })

    assert.deepEqual(requests.map(r => [r.method, r.path, r.body]), [
      ['POST', `/api/l10n/projects/${PROJECT}/key-migrations/rollback`, { migrationId: 'mig-1', dryRun: true }],
    ])
    assert.deepEqual(result, { response })
  })
})
