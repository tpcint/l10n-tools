import log from 'npmlog'
import {
  type DomainConfig,
  EntryCollection,
  type KeyEntry,
  type KeyReference,
  type L10nConfig,
  type SyncerOptions,
  type TransEntry,
  type TransMessages,
} from 'l10n-tools-core'
import { chunk, isEqual } from 'es-toolkit/compat'
import { L10nStorageApiClient } from './api-client.js'
import type {
  CreateL10nKeyInput,
  CreateSuggestionInput,
  L10nKeyMetadata,
  L10nKeyTag,
  L10nKeyToServe,
  UpdateL10nKeyInput,
} from './api-types.js'
import {
  buildContextMetadata,
  buildContextMetadataRemoving,
  buildDescriptionMetadata,
  buildGlobalMetadata,
  buildReferencesMetadata,
  buildTagMetadata,
  getContextsFromMetadata,
} from './metadata.js'

function assertBijectiveLocaleSyncMap(localeSyncMap: { [locale: string]: string }): void {
  const seen: { [serverLocale: string]: string } = {}
  for (const [localLocale, serverLocale] of Object.entries(localeSyncMap)) {
    const existing = seen[serverLocale]
    if (existing && existing !== localLocale) {
      throw new Error(
        `Invalid locale-sync-map: duplicated target locale "${serverLocale}" for "${existing}" and "${localLocale}"`,
      )
    }
    seen[serverLocale] = localLocale
  }
}

export async function syncTransToL10nStorage(
  config: L10nConfig,
  domainConfig: DomainConfig,
  tag: string,
  keyEntries: KeyEntry[],
  allTransData: { [locale: string]: TransEntry[] },
  skipUpload: boolean,
  options?: SyncerOptions,
) {
  const storageConfig = config.getL10nStorageConfig()
  const projectId = storageConfig.getProjectId()
  const configSource = storageConfig.getSource()
  const source = options?.source ?? configSource
  // The configured source (e.g. 'main') is the authoritative one that owns metadata cleanup.
  // Ephemeral sources like a PR scope must be add-only so they cannot strip contexts that
  // other sources (notably 'main') still use — context metadata is shared per tag.
  const isAuthoritativeSource = source === configSource
  const url = storageConfig.getUrl()

  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN environment variable is required')
  }

  const localeSyncMap = storageConfig.getLocaleSyncMap()
  if (localeSyncMap) assertBijectiveLocaleSyncMap(localeSyncMap)

  const apiClient = new L10nStorageApiClient(url, token)

  // 1. l10n-storage에서 정책 적용된 키 전체 조회 (keys-to-serve)
  const listedKeys = await apiClient.listAllKeysToServe(projectId)
  const listedKeyMap: { [keyName: string]: L10nKeyToServe } = {}
  for (const key of listedKeys) {
    listedKeyMap[key.keyName] = key
  }

  // 2. 로컬과 비교하여 create/update 대상 분류
  const { creatingKeys, updatingKeys } = buildKeyChanges(
    source, tag, keyEntries, allTransData, listedKeyMap, localeSyncMap, options, isAuthoritativeSource,
  )

  // 3. 서버 번역을 로컬에 반영
  updateTransEntries(keyEntries, allTransData, listedKeyMap, localeSyncMap)

  // 4. l10n-storage에 업로드
  await uploadToL10nStorage(apiClient, projectId, creatingKeys, updatingKeys, skipUpload)
}

// --- Key change detection ---

function hasTag(tags: L10nKeyTag[], tag: string, source: string): boolean {
  return tags.some(t => t.tag === tag && t.source === source)
}

function hasTranslation(key: L10nKeyToServe, locale: string): boolean {
  return key.translations.some(t => t.locale === locale)
}

function pushAddTag(updating: UpdateL10nKeyInput, tag: L10nKeyTag): void {
  if (!updating.addTags) updating.addTags = []
  updating.addTags.push(tag)
}

function pushRemoveTag(updating: UpdateL10nKeyInput, tag: L10nKeyTag): void {
  if (!updating.removeTags) updating.removeTags = []
  updating.removeTags.push(tag)
}

function pushSetMetadata(updating: UpdateL10nKeyInput, metadata: L10nKeyMetadata): void {
  if (!updating.setMetadata) updating.setMetadata = []
  const idx = updating.setMetadata.findIndex(m => m.tag === metadata.tag && m.metaKey === metadata.metaKey)
  if (idx >= 0) {
    updating.setMetadata[idx] = metadata
  } else {
    updating.setMetadata.push(metadata)
  }
}

function pushSuggestion(updating: UpdateL10nKeyInput, suggestion: CreateSuggestionInput): void {
  if (!updating.suggestions) updating.suggestions = []
  updating.suggestions.push(suggestion)
}

function creatingSuggestionHasLocale(key: CreateL10nKeyInput, locale: string): boolean {
  return key.suggestions?.some(s => s.locale === locale) ?? false
}

function updatingSuggestionHasLocale(key: UpdateL10nKeyInput, locale: string): boolean {
  return key.suggestions?.some(s => s.locale === locale) ?? false
}

function createSuggestion(locale: string, isPlural: boolean, messages: TransMessages): CreateSuggestionInput {
  if (isPlural) {
    const translation: Record<string, string> = {}
    for (const [form, value] of Object.entries(messages)) {
      if (value) translation[form] = value
    }
    return { locale, translation, suggestedBy: 'syncer' }
  } else {
    return { locale, translation: { other: messages.other! }, suggestedBy: 'syncer' }
  }
}

function mergeMetadata(existing: L10nKeyMetadata[], updates: L10nKeyMetadata[]): L10nKeyMetadata[] {
  const result = [...existing]
  for (const update of updates) {
    const idx = result.findIndex(m => m.tag === update.tag && m.metaKey === update.metaKey)
    if (idx >= 0) {
      result[idx] = update
    } else {
      result.push(update)
    }
  }
  return result
}

function mergeReferences(refs: KeyReference[]): KeyReference[] {
  const seen = new Set<string>()
  const result: KeyReference[] = []
  for (const r of refs) {
    const k = `${r.file}\0${r.loc ?? ''}`
    if (!seen.has(k)) {
      seen.add(k)
      result.push(r)
    }
  }
  return result
}

/** @internal exported for testing */
export function buildKeyChanges(
  source: string,
  tag: string,
  keyEntries: KeyEntry[],
  allTransEntries: { [locale: string]: TransEntry[] },
  listedKeyMap: { [keyName: string]: L10nKeyToServe },
  localeSyncMap?: { [locale: string]: string },
  options?: SyncerOptions,
  isAuthoritativeSource: boolean = true,
): {
  creatingKeys: CreateL10nKeyInput[],
  updatingKeys: UpdateL10nKeyInput[],
} {
  const keys = EntryCollection.loadEntries(keyEntries)
  const creatingKeyMap: { [keyName: string]: CreateL10nKeyInput } = {}
  const updatingKeyMap: { [keyName: string]: UpdateL10nKeyInput } = {}

  const additionalTags = options?.additionalTags
  const globalMetadata = options?.globalMetadata
  const tagMetadata = options?.tagMetadata

  // Pass 1: 서버에 있고 우리 source 태그가 있는 키 → 로컬에 없는 context 제거.
  // Context metadata는 (tag) 단위로 모든 source가 공유하므로, 권위가 없는 source(예: PR-N)가
  // cleanup을 수행하면 다른 source의 context를 의도치 않게 지울 수 있다.
  // 따라서 권위 source(config의 source)일 때만 Pass 1을 활성화한다. 임시 source는 add-only.
  if (isAuthoritativeSource) {
    for (const [keyName, listedKey] of Object.entries(listedKeyMap)) {
      if (!hasTag(listedKey.tags, tag, source)) continue

      for (const keyContext of getContextsFromMetadata(listedKey.metadata, tag)) {
        const keyEntry = keys.find(keyContext, keyName)
        if (keyEntry == null) {
          let updating = updatingKeyMap[keyName]
          if (!updating) {
            updating = { keyId: listedKey.id }
            updatingKeyMap[keyName] = updating
          }
          const contextMeta = buildContextMetadataRemoving(listedKey.metadata, tag, keyContext)
          if (contextMeta) {
            pushSetMetadata(updating, contextMeta)
          }
          // 모든 context가 제거되면 태그도 제거
          const remaining = getContextsFromMetadata(
            mergeMetadata(listedKey.metadata, updating.setMetadata ?? []),
            tag,
          )
          if (remaining.length === 0) {
            pushRemoveTag(updating, { tag, source })
          }
        }
      }
    }
  }

  // Pass 2: 로컬 keyEntries → 새 키 생성 또는 기존 키 업데이트.
  // 같은 keyName이 서로 다른 context로 여러 KeyEntry로 들어오는 패턴(Android에서 동일 원문이 여러
  // <string name>에 쓰이는 경우 등)을 한 번에 처리하기 위해 keyName 단위로 group한다. 이렇게 하면
  // setMetadata의 (tag, 'context')/(tag, 'description') 엔트리가 동일 group 내에서 서로를 덮어쓰지
  // 않고 누적되며, addTags도 (tag, source) 단위로 한 번만 push된다.
  const entriesByKeyName = new Map<string, KeyEntry[]>()
  for (const ke of keyEntries) {
    const arr = entriesByKeyName.get(ke.key)
    if (arr) arr.push(ke)
    else entriesByKeyName.set(ke.key, [ke])
  }

  for (const [entryKey, entries] of entriesByKeyName) {
    const listedKey = listedKeyMap[entryKey]

    if (listedKey != null) {
      let baseMetadata: L10nKeyMetadata[] = listedKey.metadata
      const metaUpdates: L10nKeyMetadata[] = []

      for (const ke of entries) {
        const contextMeta = buildContextMetadata(baseMetadata, tag, ke.context)
        if (contextMeta) {
          metaUpdates.push(contextMeta)
          baseMetadata = mergeMetadata(baseMetadata, [contextMeta])
        }
        const descMeta = buildDescriptionMetadata(baseMetadata, tag, ke.comments)
        if (descMeta) {
          metaUpdates.push(descMeta)
          baseMetadata = mergeMetadata(baseMetadata, [descMeta])
        }
      }

      // references는 group의 모든 entry refs를 합산해 매 sync 단위로 replace한다.
      // 이전 sync의 references는 base로 누적시키지 않는다(file:line이 stale일 수 있음).
      const mergedRefs = mergeReferences(entries.flatMap(e => e.references))
      const refMeta = buildReferencesMetadata(tag, mergedRefs)
      const existingRefEntry = listedKey.metadata.find(m => m.tag === tag && m.metaKey === 'references')
      const refsChanged = refMeta != null
        && (existingRefEntry == null || existingRefEntry.metaValue !== refMeta.metaValue)

      const needsTagAdd = !hasTag(listedKey.tags, tag, source)

      if (needsTagAdd || metaUpdates.length > 0 || refsChanged) {
        let updating = updatingKeyMap[entryKey]
        if (!updating) {
          updating = { keyId: listedKey.id }
          updatingKeyMap[entryKey] = updating
        }
        if (needsTagAdd) {
          pushAddTag(updating, { tag, source })
        }
        for (const u of metaUpdates) {
          pushSetMetadata(updating, u)
        }
        if (refsChanged && refMeta) {
          pushSetMetadata(updating, refMeta)
        }
      }
    } else {
      // 새 키 — group의 모든 entry 데이터를 한 번에 모은다.
      const metadata: L10nKeyMetadata[] = []

      for (const ke of entries) {
        const contextMeta = buildContextMetadata(metadata, tag, ke.context)
        if (contextMeta) {
          const idx = metadata.findIndex(m => m.tag === contextMeta.tag && m.metaKey === contextMeta.metaKey)
          if (idx >= 0) metadata[idx] = contextMeta
          else metadata.push(contextMeta)
        }
        const descMeta = buildDescriptionMetadata(metadata, tag, ke.comments)
        if (descMeta) {
          const idx = metadata.findIndex(m => m.tag === descMeta.tag && m.metaKey === descMeta.metaKey)
          if (idx >= 0) metadata[idx] = descMeta
          else metadata.push(descMeta)
        }
      }

      const mergedRefs = mergeReferences(entries.flatMap(e => e.references))
      const refMeta = buildReferencesMetadata(tag, mergedRefs)
      if (refMeta) metadata.push(refMeta)

      if (globalMetadata) {
        metadata.push(...buildGlobalMetadata(globalMetadata))
      }
      if (tagMetadata) {
        metadata.push(...buildTagMetadata(tag, tagMetadata))
      }

      const tags: L10nKeyTag[] = [{ tag, source }]
      if (additionalTags) {
        for (const t of additionalTags) {
          tags.push({ tag: t, source })
        }
      }

      creatingKeyMap[entryKey] = {
        keyName: entryKey,
        isPlural: entries[0].isPlural,
        tags,
        metadata: metadata.length > 0 ? metadata : undefined,
      }
    }
  }

  // Pass 3: 로컬 번역 → suggestions 첨부
  for (const [locale, transEntries] of Object.entries(allTransEntries)) {
    const serverLocale = localeSyncMap?.[locale] ?? locale
    for (const transEntry of transEntries) {
      const entryKey = transEntry.key
      if (!transEntry.messages.other) continue

      const listedKey = listedKeyMap[entryKey]
      if (listedKey != null) {
        // keys-to-serve는 정책 적용된 단일 translations만 노출. 해당 locale 항목이 없으면 suggestion 추가.
        // 이미 pending suggestion이 서버에 있는 경우는 storage 측 dedup에 위임.
        if (!hasTranslation(listedKey, serverLocale)) {
          let updating = updatingKeyMap[entryKey]
          if (!updating) {
            updating = { keyId: listedKey.id }
            updatingKeyMap[entryKey] = updating
          }
          if (!updatingSuggestionHasLocale(updating, serverLocale)) {
            pushSuggestion(updating, createSuggestion(serverLocale, listedKey.isPlural, transEntry.messages))
          }
        }
      } else {
        // 새 키
        const creating = creatingKeyMap[entryKey]
        if (creating && !creatingSuggestionHasLocale(creating, serverLocale)) {
          if (!creating.suggestions) creating.suggestions = []
          creating.suggestions.push(createSuggestion(serverLocale, creating.isPlural ?? false, transEntry.messages))
        }
      }
    }
  }

  return {
    creatingKeys: Object.values(creatingKeyMap),
    updatingKeys: Object.values(updatingKeyMap),
  }
}

// --- Download translations to local ---

/** @internal exported for testing */
export function updateTransEntries(
  keyEntries: KeyEntry[],
  allTransEntries: { [locale: string]: TransEntry[] },
  listedKeyMap: { [keyName: string]: L10nKeyToServe },
  localeSyncMap?: { [locale: string]: string },
) {
  // 로컬 keyEntries(소스의 한국어 원문 기준)를 순회하며, 같은 한국어 keyName을 가진 서버 키의
  // 번역을 strings.xml(values-{locale}) 라인에 적용한다. 서버 데이터에 같은 named key가 여러
  // keyName 항목 context에 동시에 등록된 부정합이 있어도, 로컬 소스의 한국어 원문이 매칭을
  // 결정하므로 결과가 안정적이다. keys-to-serve는 이미 locale별 정책이 적용된 단일 translations만
  // 내려주므로 클라이언트는 그대로 반영하기만 하면 된다. unverified flag는 더 이상 사용하지 않는다.
  for (const [locale, transEntries] of Object.entries(allTransEntries)) {
    const serverLocale = localeSyncMap?.[locale] ?? locale
    const trans = EntryCollection.loadEntries(transEntries)

    for (const keyEntry of keyEntries) {
      const listedKey = listedKeyMap[keyEntry.key]
      if (listedKey == null) continue

      const tr = listedKey.translations.find(t => t.locale === serverLocale)
      if (tr == null) continue

      const transEntry = trans.find(keyEntry.context, keyEntry.key)
      if (transEntry == null) continue

      transEntry.flag = null

      if (listedKey.isPlural) {
        const translations: Record<string, string> = {}
        for (const [form, value] of Object.entries(tr.translation)) {
          if (value) translations[form] = value
        }
        if (Object.keys(translations).length > 0 && !isEqual(transEntry.messages, translations)) {
          log.verbose('updateTransEntries', `updating ${locale} value of ${keyEntry.key}`)
          transEntry.messages = translations as TransMessages
        }
      } else {
        const value = tr.translation.other
        if (value && value !== transEntry.messages.other) {
          log.verbose('updateTransEntries', `updating ${locale} value of ${keyEntry.key}`)
          transEntry.messages = { other: value }
        }
      }
    }
  }
}

// --- Upload to l10n-storage ---

async function uploadToL10nStorage(
  apiClient: L10nStorageApiClient,
  projectId: string,
  creatingKeys: CreateL10nKeyInput[],
  updatingKeys: UpdateL10nKeyInput[],
  skipUpload: boolean,
) {
  for (const batch of chunk(creatingKeys, 500)) {
    if (skipUpload) {
      log.notice('skipUpload', 'creating keys', JSON.stringify(batch, undefined, 2))
    } else {
      log.notice('l10n-storage', 'creating keys...', batch.length)
      await apiClient.createKeys(projectId, batch)
    }
    log.info('l10n-storage', 'created key count', batch.length)
  }

  for (const batch of chunk(updatingKeys, 500)) {
    if (skipUpload) {
      log.notice('skipUpload', 'updating keys', JSON.stringify(batch, undefined, 2))
    } else {
      log.notice('l10n-storage', 'updating keys...', batch.length)
      await apiClient.updateKeys(projectId, batch)
    }
    log.info('l10n-storage', 'updated key count', batch.length)
  }
}
