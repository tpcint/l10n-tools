import log from 'npmlog'
import type { DomainConfig, KeyEntry, KeyMode, L10nConfig, SyncerKeyWarning } from 'l10n-tools-core'
import { L10nStorageApiClient } from './api-client.js'
import type { L10nKeyToServe, L10nSourceTextMatchResult } from './api-types.js'
import { buildListedKeyMap, keyEntryKind, listedKeyId } from './l10n-storage.js'

function createApiClient(config: L10nConfig): { apiClient: L10nStorageApiClient, projectId: string } {
  const storageConfig = config.getL10nStorageConfig()
  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN environment variable is required')
  }
  return {
    apiClient: new L10nStorageApiClient(storageConfig.getUrl(), token),
    projectId: storageConfig.getProjectId(),
  }
}

export async function keyModeForL10nStorage(
  config: L10nConfig,
  _domainConfig: DomainConfig,
  tag: string,
): Promise<KeyMode> {
  const { apiClient, projectId } = createApiClient(config)
  const { keyMode } = await apiClient.getTagSyncSettings(projectId, tag)
  return keyMode
}

/** 경고 대상인 새 공용 키 */
export interface NewIdKey {
  keyName: string,
  defaultValue: string,
}

function hasBaseClaim(key: L10nKeyToServe, tag: string, baseSource: string): boolean {
  return key.tags.some(t => t.tag === tag && t.source === baseSource)
}

/**
 * base 와 비교할 공용 키를 분류한다. base 의 공용 키 목록은 서버의 기본 source 점유로 대신한다 —
 * 공용 키 방식 태그의 전체 sync 가 기본 source 점유 중 로컬에 없는 키의 점유를 제거하므로, 그 점유는 마지막 기본 브랜치
 * sync 시점의 키 목록과 같다.
 * - `newKeys`: 로컬에 있지만 기본 source 점유가 없는 공용 키. 기본 문구가 비교 대상이므로 기본 문구가 없는 키, 임시값 키,
 *   복수형 키(원문 일치는 복수형 form 전체를 비교하는데 기본 문구는 `other` 하나다)는 제외한다
 * - `removedKeyNames`: 기본 source 점유가 있지만 로컬에 없는 공용 키
 * @internal exported for testing
 */
export function classifyIdKeys(
  tag: string,
  baseSource: string,
  keyEntries: KeyEntry[],
  listedKeys: L10nKeyToServe[],
): { newKeys: NewIdKey[], removedKeyNames: Set<string> } {
  const listedKeyMap = buildListedKeyMap(listedKeys)
  const localIds = new Set<string>()
  const newKeyMap = new Map<string, NewIdKey>()
  for (const ke of keyEntries) {
    if (keyEntryKind(ke) !== 'id') continue
    const id = listedKeyId('id', ke.key)
    localIds.add(id)
    const listed = listedKeyMap[id]
    if (listed != null && hasBaseClaim(listed, tag, baseSource)) continue
    if (ke.isPlural || ke.idKey!.draft || !ke.idKey!.defaultValue) continue
    if (!newKeyMap.has(ke.key)) {
      newKeyMap.set(ke.key, { keyName: ke.key, defaultValue: ke.idKey!.defaultValue })
    }
  }

  const removedKeyNames = new Set<string>()
  for (const [id, listed] of Object.entries(listedKeyMap)) {
    if ((listed.keyKind ?? 'source') !== 'id') continue
    if (localIds.has(id)) continue
    if (hasBaseClaim(listed, tag, baseSource)) {
      removedKeyNames.add(listed.keyName)
    }
  }
  return { newKeys: [...newKeyMap.values()], removedKeyNames }
}

function formatKeyNames(keyNames: string[]): string {
  return keyNames.map(k => `\`${k}\``).join(', ')
}

/**
 * 새 공용 키마다 원문이 같은 다른 공용 키를 확인해 경고를 만든다.
 * `matches` 는 `newKeys` 의 기본 문구로 조회한 원문 일치 결과다.
 * @internal exported for testing
 */
export function buildKeyWarnings(
  newKeys: NewIdKey[],
  removedKeyNames: Set<string>,
  matches: L10nSourceTextMatchResult[],
): SyncerKeyWarning[] {
  const keyNamesByText = new Map<string, string[]>()
  for (const result of matches) {
    const text = result.text.other
    if (text == null) continue
    keyNamesByText.set(text, result.keys.filter(k => k.keyKind === 'id').map(k => k.keyName))
  }

  const warnings: SyncerKeyWarning[] = []
  for (const newKey of newKeys) {
    const related = (keyNamesByText.get(newKey.defaultValue) ?? []).filter(k => k !== newKey.keyName)
    const renamed = related.filter(k => removedKeyNames.has(k))
    const reusable = related.filter(k => !removedKeyNames.has(k))
    if (renamed.length > 0) {
      warnings.push({
        kind: 'renamed-key',
        keyName: newKey.keyName,
        relatedKeyNames: renamed,
        message: `공용 키 \`${newKey.keyName}\` 의 기본 문구가 head 에서 사라진 공용 키 ${formatKeyNames(renamed)} 의 원문과 같습니다. `
          + '리소스 이름을 바꿨다면 `l10n:key` 로 기존 키를 지정했는지 확인하세요',
      })
    }
    if (reusable.length > 0) {
      warnings.push({
        kind: 'reusable-key',
        keyName: newKey.keyName,
        relatedKeyNames: reusable,
        message: `공용 키 \`${newKey.keyName}\` 의 기본 문구와 원문이 같은 공용 키 ${formatKeyNames(reusable)} 가 있습니다. 재사용을 검토하세요`,
      })
    }
  }
  return warnings
}

/**
 * PR 체크용 공용 키 경고. 경고는 체크 결과에 영향을 주지 않으므로 조회에 실패해도 경고 없이 진행한다.
 */
export async function keyWarningsForL10nStorage(
  config: L10nConfig,
  _domainConfig: DomainConfig,
  tag: string,
  source: string,
  keyEntries: KeyEntry[],
): Promise<SyncerKeyWarning[]> {
  const baseSource = config.getL10nStorageConfig().getSource()
  if (source === baseSource || !keyEntries.some(ke => ke.idKey != null)) {
    return []
  }
  try {
    const { apiClient, projectId } = createApiClient(config)
    const listedKeys = await apiClient.listKeysToServeByTag(projectId, tag)
    const { newKeys, removedKeyNames } = classifyIdKeys(tag, baseSource, keyEntries, listedKeys)
    if (newKeys.length === 0) {
      return []
    }
    const texts = [...new Set(newKeys.map(k => k.defaultValue))].map(other => ({ other }))
    const matches = await apiClient.findKeysBySourceTexts(projectId, { texts, keyKind: 'id', isPlural: false })
    return buildKeyWarnings(newKeys, removedKeyNames, matches)
  } catch (err) {
    log.warn('l10n-storage', `skipped id key warnings: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}
