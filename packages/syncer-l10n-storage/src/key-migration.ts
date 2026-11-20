import log from 'npmlog'
import type {
  DomainConfig,
  KeyEntry,
  KeyReference,
  L10nConfig,
  SyncerKeyMigrationOptions,
  SyncerKeyMigrationResult,
} from 'l10n-tools-core'
import { createApiClient, L10nKeyMigrationInvalidError } from './api-client.js'
import type {
  L10nKeyMigrationError,
  L10nKeyMigrationItemInput,
  L10nKeyMigrationResponse,
  L10nKeyMigrationRollbackResponse,
  L10nKeyMigrationTagSettingsChange,
  L10nTagSyncSettings,
} from './api-types.js'

/** `POST /key-migrations` 의 `items` 상한. 이관은 한 트랜잭션이어야 하므로 나눠 전송하지 않는다 */
const KEY_MIGRATION_ITEMS_LIMIT = 10_000

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function referenceId(ref: KeyReference): string {
  return `${ref.file}\0${ref.loc ?? ''}`
}

function formatReference(ref: KeyReference): string {
  return ref.loc != null ? `${ref.file}:${ref.loc}` : ref.file
}

/**
 * 같은 참조 위치를 두 항목이 가지면 어느 리소스인지 판정할 수 없다. 위치를 기록하지 않는 추출기에서 생긴다.
 */
function indexByReference(entries: KeyEntry[], label: string): Map<string, KeyEntry> {
  const map = new Map<string, KeyEntry>()
  for (const entry of entries) {
    if (entry.references.length === 0) {
      throw new Error(`cannot pair keys: ${label} key ${JSON.stringify(entry.key)} has no reference`)
    }
    for (const ref of entry.references) {
      const id = referenceId(ref)
      const existing = map.get(id)
      if (existing != null && existing !== entry) {
        throw new Error(`cannot pair keys: ${formatReference(ref)} has two ${label} keys `
          + `${JSON.stringify(existing.key)} and ${JSON.stringify(entry.key)}`)
      }
      map.set(id, entry)
    }
  }
  return map
}

/**
 * 같은 리포 파일을 원문 키 방식과 공용 키 방식으로 각각 추출한 결과에서, 리소스마다 「공용 키 → 지금 쓰는 원문 키」 이관
 * 항목을 만든다. 두 추출 결과의 같은 참조 위치가 같은 리소스다. 공용 키 방식에서도 원문 키로 추출되는 리소스는 이관하지
 * 않는다. 항목은 리소스마다 하나이며 `contexts` 는 원문 키 방식 추출의 context(원문 키의 태그 context 메타데이터에 기록된
 * 값)다. 같은 공용 키를 쓰는 리소스가 여럿이면 서버가 `contexts` 를 합친다.
 * @internal exported for testing
 */
export function buildKeyMigrationItems(sourceKeyEntries: KeyEntry[], idKeyEntries: KeyEntry[]): L10nKeyMigrationItemInput[] {
  const sourceEntries = sourceKeyEntries.filter(entry => entry.idKey == null)
  const sourceEntryByRef = indexByReference(sourceEntries, 'source')
  const idEntryByRef = indexByReference(idKeyEntries, 'id-mode')

  const items: L10nKeyMigrationItemInput[] = []
  for (const [refId, sourceEntry] of sourceEntryByRef) {
    const idEntry = idEntryByRef.get(refId)
    const ref = sourceEntry.references.find(r => referenceId(r) === refId)!
    if (idEntry == null) {
      throw new Error(`cannot pair keys: no id-mode key at ${formatReference(ref)} for source key ${JSON.stringify(sourceEntry.key)}`)
    }
    if (idEntry.idKey == null) {
      continue
    }
    if (idEntry.isPlural !== sourceEntry.isPlural) {
      throw new Error(`cannot pair keys: ${formatReference(ref)} is ${sourceEntry.isPlural ? '' : 'not '}plural in source mode `
        + `but ${idEntry.isPlural ? '' : 'not '}plural in id mode`)
    }
    items.push({
      idKeyName: idEntry.key,
      sourceKeyName: sourceEntry.key,
      contexts: sourceEntry.context != null ? [sourceEntry.context] : [],
    })
  }

  for (const [refId, idEntry] of idEntryByRef) {
    if (idEntry.idKey != null && !sourceEntryByRef.has(refId)) {
      const ref = idEntry.references.find(r => referenceId(r) === refId)!
      throw new Error(`cannot pair keys: no source key at ${formatReference(ref)} for id key ${JSON.stringify(idEntry.key)}`)
    }
  }

  if (items.length > KEY_MIGRATION_ITEMS_LIMIT) {
    throw new Error(`too many resources to migrate in one transaction: ${items.length} (limit ${KEY_MIGRATION_ITEMS_LIMIT})`)
  }
  return items.sort((a, b) => compareStrings(a.idKeyName, b.idKeyName) || compareStrings(a.contexts[0] ?? '', b.contexts[0] ?? ''))
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// --- 출력 ---

export interface KeyMigrationLogLine {
  level: 'info' | 'warn' | 'error',
  message: string,
}

function formatTagSettings(settings: L10nTagSyncSettings): string {
  return `keyMode=${settings.keyMode}, minSyncerVersion=${settings.minSyncerVersion ?? 'null'}`
}

function formatTagSettingsChange(change: L10nKeyMigrationTagSettingsChange): string {
  return `tag ${change.after.tag}: ${formatTagSettings(change.before)} -> ${formatTagSettings(change.after)}`
}

function formatMigrationError(error: L10nKeyMigrationError): string {
  return `[${error.reason}] items[${error.index}] ${error.idKeyName} <- ${JSON.stringify(error.sourceKeyName)}: ${error.message}`
}

/** @internal exported for testing */
export function formatKeyMigrationErrors(errors: L10nKeyMigrationError[]): KeyMigrationLogLine[] {
  const lines: KeyMigrationLogLine[] = errors.map(error => ({ level: 'error', message: formatMigrationError(error) }))
  if (errors.some(error => error.reason === 'source-key-not-found')) {
    lines.push({
      level: 'error',
      message: 'source-key-not-found: run migrate-keys on the default branch after its sync has uploaded every resource',
    })
  }
  return lines
}

/**
 * 이관 응답을 사람이 읽는 줄로 만든다. 오류·충돌·경고는 모두 출력하고, 항목별 복사 내역은 `--output` 파일에만 기록한다.
 * @internal exported for testing
 */
export function formatKeyMigrationResponse(response: L10nKeyMigrationResponse, projectId: string): KeyMigrationLogLine[] {
  const { summary } = response
  const prefix = response.dryRun ? '[dry-run] ' : ''
  const lines: KeyMigrationLogLine[] = [
    {
      level: 'info',
      message: `${prefix}${summary.items} items: ${summary.idKeysCreated} id keys created, ${summary.idKeysReused} reused, `
        + `${summary.translationsCopied} translations and ${summary.suggestionsCopied} suggestions copied, `
        + `${summary.tagsMoved} tag claims moved, ${summary.conflicts} conflicts`,
    },
    { level: 'info', message: `${prefix}${formatTagSettingsChange(response.tagSettings)}` },
  ]

  lines.push(...formatKeyMigrationErrors(response.errors))

  for (const item of response.items) {
    const label = `${item.idKeyName} <- ${JSON.stringify(item.sourceKeyName)}`
    for (const conflict of item.conflicts) {
      lines.push({
        level: 'warn',
        message: `conflict: ${label} [${conflict.locale} ${conflict.status}] keeps ${JSON.stringify(conflict.existing)}, `
          + `not copying ${JSON.stringify(conflict.incoming)}`,
      })
    }
    for (const warning of item.warnings) {
      lines.push({ level: 'warn', message: `${label}: ${warning}` })
    }
  }

  const plan = response.rollbackPlan
  if (response.migrationId != null && plan != null) {
    lines.push({
      level: 'info',
      message: `migration ${response.migrationId} applied. rollback plan: untag ${plan.untag.length} id keys, `
        + `retag ${plan.retag.length} source keys, restore ${plan.restoreMetadata.length} metadata, `
        + `tag settings back to ${formatTagSettings(plan.tagSettings)}`,
    })
    lines.push({ level: 'info', message: `to roll back: ${rollbackCommand(projectId, response.migrationId)}` })
  } else if (response.dryRun) {
    lines.push({
      level: 'info',
      message: `[dry-run] applying this plan can be rolled back with '${rollbackCommand(projectId, '<migrationId>')}': `
        + `moved tag claims and contexts are restored and tag settings go back to ${formatTagSettings(response.tagSettings.before)}`,
    })
  }
  return lines
}

/** 되돌리기는 이관한 프로젝트에 요청해야 하므로 rc 의 프로젝트가 아니어도 되도록 항상 지정한다 */
function rollbackCommand(projectId: string, migrationId: string): string {
  return `l10n --project-id ${projectId} migrate-keys --rollback ${migrationId}`
}

/** @internal exported for testing */
export function formatKeyMigrationRollbackResponse(response: L10nKeyMigrationRollbackResponse): KeyMigrationLogLine[] {
  const prefix = response.dryRun ? '[dry-run] ' : ''
  return [
    {
      level: 'info',
      message: `${prefix}rollback ${response.migrationId}: ${response.untagged} id keys untagged, `
        + `${response.retagged} source keys retagged, ${response.metadataRestored} metadata restored`,
    },
    { level: 'info', message: `${prefix}${formatTagSettingsChange(response.tagSettings)}` },
    ...response.warnings.map((warning): KeyMigrationLogLine => ({ level: 'warn', message: warning })),
  ]
}

function writeLogLines(lines: KeyMigrationLogLine[]): void {
  for (const line of lines) {
    log[line.level]('migrate-keys', line.message)
  }
}

// --- 명령 ---

export async function migrateKeysInL10nStorage(
  config: L10nConfig,
  _domainConfig: DomainConfig,
  tag: string,
  sourceKeyEntries: KeyEntry[],
  idKeyEntries: KeyEntry[],
  options: SyncerKeyMigrationOptions,
): Promise<SyncerKeyMigrationResult> {
  if (!SEMVER_PATTERN.test(options.minSyncerVersion)) {
    throw new Error(`invalid minimum syncer version ${JSON.stringify(options.minSyncerVersion)}: must be semver (e.g. 1.6.0)`)
  }
  const items = buildKeyMigrationItems(sourceKeyEntries, idKeyEntries)
  if (items.length === 0) {
    // 추출기가 공용 키 방식을 지원하지 않는 도메인이다. 성공으로 끝내면 태그가 전환되지 않은 것을 알 수 없다.
    log.error('migrate-keys', `tag ${tag}: no resource uses an id key; the extractor of this domain does not support id keys`)
    return { migrationId: null, errorCount: 1, response: null }
  }

  const { apiClient, projectId } = createApiClient(config)
  // 열린 PR 의 (tag, PR-N) 점유는 이관하지 않는다. 기본 브랜치 sync 가 등록한 점유만 이동한다.
  const source = config.getL10nStorageConfig().getSource()
  const prefix = options.dryRun ? '[dry-run] ' : ''
  log.info('migrate-keys', `${prefix}migrating ${items.length} resources of tag ${tag} (source ${source}) in project ${projectId}`)
  try {
    const response = await apiClient.migrateKeys(projectId, {
      dryRun: options.dryRun,
      tag,
      source,
      items,
      tagSettings: { keyMode: 'id', minSyncerVersion: options.minSyncerVersion },
    })
    writeLogLines(formatKeyMigrationResponse(response, projectId))
    return { migrationId: response.migrationId, errorCount: response.errors.length, response }
  } catch (err) {
    if (err instanceof L10nKeyMigrationInvalidError) {
      log.error('migrate-keys', `migration rejected, nothing was written: ${err.message}`)
      writeLogLines(formatKeyMigrationErrors(err.errors))
      // 거부 응답에 오류 목록이 없으면 건수를 알 수 없지만 적용되지 않았으므로 오류로 간주한다
      return { migrationId: null, errorCount: Math.max(err.errors.length, 1), response: { errors: err.errors } }
    }
    throw err
  }
}

export async function rollbackKeyMigrationInL10nStorage(
  config: L10nConfig,
  migrationId: string,
  options: { dryRun: boolean },
): Promise<{ response: unknown }> {
  const { apiClient, projectId } = createApiClient(config)
  log.info('migrate-keys', `${options.dryRun ? '[dry-run] ' : ''}rolling back migration ${migrationId} in project ${projectId}`)
  const response = await apiClient.rollbackKeyMigration(projectId, { migrationId, dryRun: options.dryRun })
  writeLogLines(formatKeyMigrationRollbackResponse(response))
  return { response }
}
