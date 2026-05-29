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
  RemoveTagInput,
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
  // 두 가지 sync 모드를 구분한다.
  // - **전체 sync** (`source === configSource`, options.source 미지정): 이 태그의 모든 키를 대상으로
  //   하는 sync. 로컬에 없는 키는 (tag) 자체를 source-omitted로 unclaim 가능. 새 키가 추가될 때
  //   특정 PR이 아니므로 default source(configSource, 보통 'main')가 부여된다.
  // - **특정 source sync** (`options.source = 'PR-N'`): PR 스코프 sync. 자기 (tag, source) 범위만
  //   관리하고 다른 source의 claim/공유 metadata는 절대 건드리지 않는다.
  // main이 특별한 게 아니라, "특정 PR이 아닐 때 default source가 main"인 것일 뿐 main과 PR-N은 동등.
  const isFullSync = source === configSource
  const url = storageConfig.getUrl()

  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN environment variable is required')
  }

  const localeSyncMap = storageConfig.getLocaleSyncMap()
  if (localeSyncMap) assertBijectiveLocaleSyncMap(localeSyncMap)

  const apiClient = new L10nStorageApiClient(url, token)

  // 1. 이 sync가 다루는 태그가 달린 키만 l10n-storage에서 조회 (keys-to-serve, tag-filtered).
  // 핵심 원칙: l10n-storage 호출은 항상 "태그"를 동반한다 — 이 프로젝트가 관리하는 키의 범위.
  // tag 필터는 orphan(어떤 태그/source에서도 claim되지 않은 키)을 자연 제외하므로, 결과는
  // "이 태그로 claim된 키"의 정확한 집합이다. 로컬 추출에 없는 키는 unclaim 대상이 된다.
  // 로컬에는 있지만 listedKeyMap에 없는 키는 (a) 정말 새 키이거나 (b) 다른 태그로만 존재하는
  // 또는 orphan으로 부활시킬 키다 — 둘 다 Pass 2의 createKeys 경로가 서버 측에서 처리한다
  // (keyName 중복 시 서버가 자동으로 add-tag로 부활시킨다).
  const listedKeys = await apiClient.listKeysToServeByTag(projectId, tag)
  const listedKeyMap: { [keyName: string]: L10nKeyToServe } = {}
  for (const key of listedKeys) {
    listedKeyMap[key.keyName] = key
  }

  // 2. 로컬과 비교하여 create/update 대상 분류
  const { creatingKeys, updatingKeys } = buildKeyChanges(
    source, tag, keyEntries, allTransData, listedKeyMap, localeSyncMap, options, isFullSync,
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

function hasTagAnySource(tags: L10nKeyTag[], tag: string): boolean {
  return tags.some(t => t.tag === tag)
}

function hasTranslation(key: L10nKeyToServe, locale: string): boolean {
  return key.translations.some(t => t.locale === locale)
}

function pushAddTag(updating: UpdateL10nKeyInput, tag: L10nKeyTag): void {
  if (!updating.addTags) updating.addTags = []
  updating.addTags.push(tag)
}

function pushRemoveTag(updating: UpdateL10nKeyInput, tag: RemoveTagInput): void {
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
  isFullSync: boolean = true,
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

  // 로컬 keyEntries를 keyName 단위로 group한다. 같은 keyName이 서로 다른 context로 여러 KeyEntry로
  // 들어오는 패턴(Android에서 동일 원문이 여러 <string name>에 쓰이는 경우 등)을 한 번에 처리하기
  // 위함이다. 이렇게 하면 setMetadata의 (tag, 'context')/(tag, 'description') 엔트리가 동일 group
  // 내에서 서로를 덮어쓰지 않고 누적되며, addTags도 (tag, source) 단위로 한 번만 push된다.
  // Pass 1의 orphan 판정(로컬 추출에 없는 키)에도 사용하므로 두 pass보다 먼저 만든다.
  const entriesByKeyName = new Map<string, KeyEntry[]>()
  for (const ke of keyEntries) {
    const arr = entriesByKeyName.get(ke.key)
    if (arr) arr.push(ke)
    else entriesByKeyName.set(ke.key, [ke])
  }

  // Pass 1: 서버에 있는(이미 tag-filtered) 키 중 로컬 추출에 없는 것의 정리.
  // - 전체 sync: 이 태그의 모든 키를 대상으로 하므로 로컬에 없는 키의 (tag) 자체를 source-omitted로
  //   일괄 unclaim한다. context가 있는 도메인(Android 등)은 우선 로컬에 없는 context를 제거하고
  //   context가 하나도 남지 않을 때만 unclaim한다. context-less 도메인(web4 vue-i18n 등)은 key
  //   단위로 즉시 unclaim한다. PR 1161 단일-source 모델에서 (tag) PK당 source는 하나뿐이므로
  //   source 생략은 그 한 row를 깨끗이 제거하며, 누구든 점유 중인 claim도 같이 정리된다.
  // - 특정 source sync(예: --source PR-N): 공유 context는 절대 건드리지 않되, 로컬 추출에서 완전히
  //   사라진 키의 자기 (tag, source) 태그만 제거한다. PR이 도중 추가했다가 도중 제거한 키의 자기
  //   claim을 정리해 PR 체크런이 stale orphan으로 고착되는 회귀(#358)를 막는다. 자기 태그 제거는
  //   다른 source에 영향을 주지 않아 안전하다.
  if (isFullSync) {
    for (const [keyName, listedKey] of Object.entries(listedKeyMap)) {
      const serverContexts = getContextsFromMetadata(listedKey.metadata, tag)

      if (serverContexts.length === 0) {
        // context-less 도메인: 로컬에 없는 키면 즉시 (tag, *) unclaim.
        if (entriesByKeyName.has(keyName)) continue
        let updating = updatingKeyMap[keyName]
        if (!updating) {
          updating = { keyId: listedKey.id }
          updatingKeyMap[keyName] = updating
        }
        pushRemoveTag(updating, { tag })
        continue
      }

      // context-ful 도메인: 로컬에 없는 context는 제거하고, 다 빠지면 (tag, *) unclaim.
      // 여러 context가 한 번에 빠질 때 buildContextMetadataRemoving이 매번 원본 listedKey.metadata만
      // 보고 "그 context 하나만 빠진" 결과를 만들면 pushSetMetadata의 replace로 마지막 iteration만
      // 살아남는다. baseMetadata를 누적해 매 iteration 직전 상태를 기준으로 다음 context를 빼야 모든
      // orphan context가 빠진다.
      let baseMetadata = listedKey.metadata
      let touched = false
      for (const keyContext of serverContexts) {
        const keyEntry = keys.find(keyContext, keyName)
        if (keyEntry != null) continue
        const contextMeta = buildContextMetadataRemoving(baseMetadata, tag, keyContext)
        if (contextMeta == null) continue
        let updating = updatingKeyMap[keyName]
        if (!updating) {
          updating = { keyId: listedKey.id }
          updatingKeyMap[keyName] = updating
        }
        pushSetMetadata(updating, contextMeta)
        baseMetadata = mergeMetadata(baseMetadata, [contextMeta])
        touched = true
      }
      if (touched && getContextsFromMetadata(baseMetadata, tag).length === 0) {
        pushRemoveTag(updatingKeyMap[keyName]!, { tag })
      }
    }
  } else {
    for (const [keyName, listedKey] of Object.entries(listedKeyMap)) {
      if (!hasTag(listedKey.tags, tag, source)) continue
      // 로컬 추출에 아직 있으면 Pass 2에서 처리(claim 유지). 사라진 키만 orphan으로 본다.
      if (entriesByKeyName.has(keyName)) continue

      let updating = updatingKeyMap[keyName]
      if (!updating) {
        updating = { keyId: listedKey.id }
        updatingKeyMap[keyName] = updating
      }
      // 자기 (tag, source) 태그만 제거. 공유 context/description metadata는 건드리지 않는다.
      pushRemoveTag(updating, { tag, source })
    }
  }

  // Pass 2: 로컬 keyEntries → 새 키 생성 또는 기존 키 업데이트.
  for (const [entryKey, entries] of entriesByKeyName) {
    const listedKey = listedKeyMap[entryKey]

    if (listedKey != null) {
      let baseMetadata: L10nKeyMetadata[] = listedKey.metadata
      const metaUpdates: L10nKeyMetadata[] = []
      let contextAdded = false

      for (const ke of entries) {
        const contextMeta = buildContextMetadata(baseMetadata, tag, ke.context)
        if (contextMeta) {
          metaUpdates.push(contextMeta)
          baseMetadata = mergeMetadata(baseMetadata, [contextMeta])
          contextAdded = true
        }
        const descMeta = buildDescriptionMetadata(baseMetadata, tag, ke.comments)
        if (descMeta) {
          metaUpdates.push(descMeta)
          baseMetadata = mergeMetadata(baseMetadata, [descMeta])
        }
      }

      // references는 group의 모든 entry refs를 합산해 매 sync 단위로 replace한다.
      // 이전 sync의 references는 base로 누적시키지 않는다(file:line이 stale일 수 있음).
      // 이번 sync에서 refs가 0건이지만 서버에 기존 entry가 있으면, stale `file:loc`이 남지 않도록
      // 빈 array("[]")로 명시적으로 replace한다.
      const mergedRefs = mergeReferences(entries.flatMap(e => e.references))
      const mergedRefsValue = JSON.stringify(mergedRefs)
      const existingRefEntry = listedKey.metadata.find(m => m.tag === tag && m.metaKey === 'references')
      const refsChanged = (mergedRefs.length > 0 || existingRefEntry != null)
        && (existingRefEntry == null || existingRefEntry.metaValue !== mergedRefsValue)

      // 특정 source sync(PR-N 등)의 claim 조건. 단순히 keyEntries에 키를 포함시킨 것만으로 모든 키에
      // PR-N 태그를 붙이면, PR scope sync마다 모든 키가 update 대상으로 잡혀 storage에 폭주 알림이
      // 발생한다(#346). 그래서 특정 source sync는 다음 중 하나일 때만 claim한다:
      //   - contextAdded: 키에 새 context를 추가 (Android에서 동일 원문을 새 <string name>에 쓰는 경우).
      //   - !hasAnyOwnTag: 이 태그가 이 키를 처음 다룸. 다른 repo가 만든 기존 키를 이 도메인이 처음
      //     사용하기 시작하는 마이그레이션 케이스. context가 없는 도메인(예: web4 vue-i18n)은 contextAdded가
      //     영영 false라, 이 신호가 없으면 기존 키를 절대 claim하지 못한다(회귀). 폭주는 발생하지 않는데,
      //     이 도메인이 이미 다루던 키는 (tag, main 등) 자기 태그를 가져 hasAnyOwnTag가 true이기 때문이다.
      // description/references 변경은 source filter에 노출되지 않아 PR apply에 propagate할 필요가 없으므로
      // claim 대상에서 제외한다. 전체 sync는 tag ownership 관리 책임이 있어 자기 (tag, source)가 없으면
      // 항상 claim(isFullSync 단락평가로 동작 불변).
      const hasOwnSourceTag = hasTag(listedKey.tags, tag, source)
      const hasAnyOwnTag = hasTagAnySource(listedKey.tags, tag)
      const needsTagAdd = !hasOwnSourceTag && (isFullSync || contextAdded || !hasAnyOwnTag)

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
        if (refsChanged) {
          pushSetMetadata(updating, { tag, metaKey: 'references', metaValue: mergedRefsValue })
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
