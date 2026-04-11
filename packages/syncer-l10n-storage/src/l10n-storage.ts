import log from 'npmlog'
import {
  type DomainConfig,
  EntryCollection,
  type KeyEntry,
  type L10nConfig,
  type SyncerOptions,
  type TransEntry,
  type TransMessages,
} from 'l10n-tools-core'
import { chunk, invert, isEqual } from 'es-toolkit/compat'
import { L10nStorageApiClient } from './api-client.js'
import type {
  CreateL10nKeyInput,
  CreateSuggestionInput,
  L10nKey,
  L10nKeyMetadata,
  L10nKeyTag,
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
  metadataContainsContext,
  metadataContainsDescription,
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
  const source = options?.source ?? storageConfig.getSource()
  const url = storageConfig.getUrl()

  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN environment variable is required')
  }

  const localeSyncMap = storageConfig.getLocaleSyncMap()
  if (localeSyncMap) assertBijectiveLocaleSyncMap(localeSyncMap)
  const invertedSyncMap = localeSyncMap ? invert(localeSyncMap) : undefined

  const apiClient = new L10nStorageApiClient(url, token)

  // 1. l10n-storage에서 키 전체 조회
  const listedKeys = await apiClient.listAllKeys(projectId)
  const listedKeyMap: { [keyName: string]: L10nKey } = {}
  for (const key of listedKeys) {
    listedKeyMap[key.keyName] = key
  }

  // 2. 로컬과 비교하여 create/update 대상 분류
  const { creatingKeys, updatingKeys } = buildKeyChanges(
    source, tag, keyEntries, allTransData, listedKeyMap, localeSyncMap, options,
  )

  // 3. 서버 번역을 로컬에 반영
  updateTransEntries(tag, allTransData, listedKeyMap, invertedSyncMap)

  // 4. l10n-storage에 업로드
  await uploadToL10nStorage(apiClient, projectId, creatingKeys, updatingKeys, skipUpload)
}

// --- Key change detection ---

function hasTag(tags: L10nKeyTag[], tag: string, source: string): boolean {
  return tags.some(t => t.tag === tag && t.source === source)
}

function hasTagName(tags: L10nKeyTag[], tag: string): boolean {
  return tags.some(t => t.tag === tag)
}

function hasTranslation(key: L10nKey, locale: string): boolean {
  return key.translations.some(t => t.locale === locale)
}

function hasSuggestion(key: L10nKey, locale: string): boolean {
  return key.suggestions.some(s => s.locale === locale)
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

/** @internal exported for testing */
export function buildKeyChanges(
  source: string,
  tag: string,
  keyEntries: KeyEntry[],
  allTransEntries: { [locale: string]: TransEntry[] },
  listedKeyMap: { [keyName: string]: L10nKey },
  localeSyncMap?: { [locale: string]: string },
  options?: SyncerOptions,
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

  // Pass 1: 서버에 있고 우리 source 태그가 있는 키 → 로컬에 없는 context 제거
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

  // Pass 2: 로컬 keyEntries → 새 키 생성 또는 기존 키 업데이트
  for (const keyEntry of keyEntries) {
    const entryKey = keyEntry.key
    const listedKey = listedKeyMap[entryKey]

    if (listedKey != null) {
      const needsTagAdd = !hasTagName(listedKey.tags, tag)
      const needsContextUpdate = !metadataContainsContext(listedKey.metadata, tag, keyEntry.context)
      const needsDescriptionUpdate = !metadataContainsDescription(listedKey.metadata, tag, keyEntry.comments)

      if (needsTagAdd || needsContextUpdate || needsDescriptionUpdate) {
        let updating = updatingKeyMap[entryKey]
        if (!updating) {
          updating = { keyId: listedKey.id }
          updatingKeyMap[entryKey] = updating
        }
        if (needsTagAdd) {
          pushAddTag(updating, { tag, source })
        }
        if (needsContextUpdate) {
          const contextMeta = buildContextMetadata(listedKey.metadata, tag, keyEntry.context)
          if (contextMeta) pushSetMetadata(updating, contextMeta)
        }
        if (needsDescriptionUpdate) {
          const descMeta = buildDescriptionMetadata(tag, keyEntry.comments)
          if (descMeta) pushSetMetadata(updating, descMeta)
        }
      }
      // references는 항상 갱신
      const refMeta = buildReferencesMetadata(tag, keyEntry.references)
      if (refMeta) {
        let updating = updatingKeyMap[entryKey]
        if (!updating) {
          updating = { keyId: listedKey.id }
          updatingKeyMap[entryKey] = updating
        }
        pushSetMetadata(updating, refMeta)
      }
    } else {
      // 새 키 생성
      const metadata: L10nKeyMetadata[] = []
      const contextMeta = buildContextMetadata([], tag, keyEntry.context)
      if (contextMeta) metadata.push(contextMeta)
      const descMeta = buildDescriptionMetadata(tag, keyEntry.comments)
      if (descMeta) metadata.push(descMeta)
      const refMeta = buildReferencesMetadata(tag, keyEntry.references)
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
        isPlural: keyEntry.isPlural,
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
        // 기존 키: translation도 suggestion도 없는 locale만
        if (!hasTranslation(listedKey, serverLocale) && !hasSuggestion(listedKey, serverLocale)) {
          let updating = updatingKeyMap[entryKey]
          if (!updating) {
            updating = { keyId: listedKey.id }
            updatingKeyMap[entryKey] = updating
          }
          pushSuggestion(updating, createSuggestion(serverLocale, listedKey.isPlural, transEntry.messages))
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

function updateTransEntries(
  tag: string,
  allTransEntries: { [locale: string]: TransEntry[] },
  listedKeyMap: { [keyName: string]: L10nKey },
  invertedSyncMap?: { [locale: string]: string },
) {
  for (const [keyName, key] of Object.entries(listedKeyMap)) {
    const translatedLocales = new Set(key.translations.map(t => t.locale))

    // 1. 확정 번역 반영
    for (const tr of key.translations) {
      const locale = invertedSyncMap?.[tr.locale] ?? tr.locale
      if (allTransEntries[locale] == null) continue

      const trans = EntryCollection.loadEntries(allTransEntries[locale])
      const contexts = [...getContextsFromMetadata(key.metadata, tag), null]

      for (const keyContext of contexts) {
        const transEntry = trans.find(keyContext, keyName)
        if (!transEntry) continue

        transEntry.flag = null

        if (key.isPlural) {
          const translations: Record<string, string> = {}
          for (const [form, value] of Object.entries(tr.translation)) {
            if (value) translations[form] = value
          }
          if (Object.keys(translations).length > 0 && !isEqual(transEntry.messages, translations)) {
            log.verbose('updateTransEntries', `updating ${locale} value of ${keyName}`)
            transEntry.messages = translations as TransMessages
          }
        } else {
          const value = tr.translation.other
          if (value && value !== transEntry.messages.other) {
            log.verbose('updateTransEntries', `updating ${locale} value of ${keyName}`)
            transEntry.messages = { other: value }
          }
        }
      }
    }

    // 2. 확정 번역이 없는 locale의 pending suggestion → unverified로 반영
    for (const sugg of key.suggestions) {
      if (translatedLocales.has(sugg.locale)) continue
      const locale = invertedSyncMap?.[sugg.locale] ?? sugg.locale
      if (allTransEntries[locale] == null) continue

      const trans = EntryCollection.loadEntries(allTransEntries[locale])
      const contexts = [...getContextsFromMetadata(key.metadata, tag), null]

      for (const keyContext of contexts) {
        const transEntry = trans.find(keyContext, keyName)
        if (!transEntry) continue

        transEntry.flag = 'unverified'

        if (key.isPlural) {
          const translations: Record<string, string> = {}
          for (const [form, value] of Object.entries(sugg.translation)) {
            if (value) translations[form] = value
          }
          if (Object.keys(translations).length > 0 && !isEqual(transEntry.messages, translations)) {
            log.verbose('updateTransEntries', `updating ${locale} value of ${keyName} (unverified)`)
            transEntry.messages = translations as TransMessages
          }
        } else {
          const value = sugg.translation.other
          if (value && value !== transEntry.messages.other) {
            log.verbose('updateTransEntries', `updating ${locale} value of ${keyName} (unverified)`)
            transEntry.messages = { other: value }
          }
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
