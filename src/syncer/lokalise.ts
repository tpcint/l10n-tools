import log from 'npmlog'
import type { DomainConfig, L10nConfig, LokaliseConfig } from '../config.js'
import type { KeyEntry, TransEntry, TransMessages } from '../entry.js'
import {
  type CreateKeyData,
  type Key,
  LokaliseApi,
  type SupportedPlatforms,
  type TranslationData,
  type UpdateKeyDataWithId,
} from '@lokalise/node-api'
import { chunk, isEqual, pickBy } from 'es-toolkit/compat'
import PQueue from 'p-queue'
import { addContext, containsContext, getContexts, removeContext } from './lokalise-context.js'
import { addToArraySet, isPureKey, removeFromArraySet } from '../utils.js'
import { EntryCollection } from '../entry-collection.js'
import { addComment, containsComment } from './lokalise-comment.js'

export async function syncTransToLokalise(config: L10nConfig, domainConfig: DomainConfig, tag: string, keyEntries: KeyEntry[], allTransData: { [locale: string]: TransEntry[] }, drySync: boolean) {
  const lokaliseConfig = config.getLokaliseConfig()
  const lokaliseApi = new LokaliseApi({ apiKey: lokaliseConfig.getToken() })
  const projectId = lokaliseConfig.getProjectId()
  const platform = domainConfig.getLokalisePlatform()

  // 1. Lokalise 에서 키 읽어오기
  const listedKeys = await listLokaliseKeys(lokaliseApi, projectId, lokaliseConfig)
  const listedKeyMap: { [keyName: string]: Key } = {}
  for (const key of listedKeys) {
    const keyPlatform = key.key_name[platform]
    if (keyPlatform) {
      listedKeyMap[keyPlatform] = key
    }
  }
  // 2. 로컬 번역과 비교하여 Lokalise 에 업로드할 데이터 만들기
  const {
    creatingKeyMap,
    updatingKeyMap,
  } = updateKeyData(platform, tag, keyEntries, allTransData, listedKeyMap)
  // 3. 로컬 번역 업데이트
  updateTransEntries(tag, lokaliseConfig, keyEntries, allTransData, listedKeyMap)
  // 4. 2에서 준비한 데이터 Lokalise 에 업로드
  await uploadToLokalise(lokaliseApi, projectId, tag, lokaliseConfig, creatingKeyMap, updatingKeyMap, drySync)
}

async function listLokaliseKeys(lokaliseApi: LokaliseApi, projectId: string, config: LokaliseConfig) {
  log.info('lokaliseApi', 'listing keys')
  const invertedSyncMap = config.getLocaleSyncMap(true)

  const totalCount = await getTotalKeyCount(lokaliseApi, projectId)
  const numPages = Math.ceil(totalCount / 500)

  const queue = new PQueue({ interval: 500, intervalCap: 1, concurrency: 2 })
  const chunkPromises: Promise<Key[]>[] = []
  for (let page = 1; page <= numPages; page++) {
    chunkPromises.push(queue.add(async () => {
      try {
        log.info('lokaliseApi', `fetched key (page ${page}) started`)
        const pagedKeys = await lokaliseApi.keys().list({
          project_id: projectId,
          include_translations: 1,
          limit: 500,
          page: page,
        })
        log.info('lokaliseApi', `fetched key (page ${page}) done`, pagedKeys.items.length)
        return pagedKeys.items.map(key => reverseLocaleSyncMap(key, invertedSyncMap))
      } catch (err) {
        log.error('lokaliseApi', 'fetching keys failed', err)
        throw err
      }
    }))
  }
  const chunks = await Promise.all(chunkPromises)
  return chunks.flat()
}

async function getTotalKeyCount(lokaliseApi: LokaliseApi, projectId: string): Promise<number> {
  try {
    const pagedKeys = await lokaliseApi.keys().list({
      project_id: projectId,
      limit: 1,
      page: 1,
    })
    log.info('lokaliseApi', 'fetched key count', pagedKeys.totalResults)
    return pagedKeys.totalResults
  } catch (err) {
    log.error('lokaliseApi', 'fetching key count failed', err)
    throw err
  }
}

function reverseLocaleSyncMap(key: Key, invertedSyncMap: { [locale: string]: string } | undefined): Key {
  if (invertedSyncMap == null) {
    return key
  }
  return {
    ...key,
    translations: key.translations.map(tr => ({
      ...tr,
      language_iso: invertedSyncMap[tr.language_iso] ?? tr.language_iso,
    })),
  }
}

function createUpdateKeyDataByAddingKeyEntry(platform: SupportedPlatforms, tag: string, key: Key | UpdateKeyDataWithId, entry: KeyEntry): UpdateKeyDataWithId {
  return {
    key_id: key.key_id,
    key_name: entry.key,
    platforms: addToArraySet(key.platforms ?? [], platform),
    tags: addToArraySet(key.tags ?? [], tag),
    context: addContext(key.context, tag, entry.context),
    description: addComment(key.description, tag, entry.comments),
  }
}

function createUpdateKeyDataByAddingTransEntry(platform: SupportedPlatforms, tag: string, key: Key | UpdateKeyDataWithId, entry: TransEntry): UpdateKeyDataWithId {
  return {
    key_id: key.key_id,
    key_name: entry.key,
    platforms: addToArraySet(key.platforms ?? [], platform),
    tags: addToArraySet(key.tags ?? [], tag),
    context: addContext(key.context, tag, entry.context),
  }
}

function createUpdateKeyDataByRemoving(platform: SupportedPlatforms, tag: string, key: Key | UpdateKeyDataWithId, keyName: string, keyContext: string | null): UpdateKeyDataWithId {
  const context = removeContext(key.context, tag, keyContext)
  if (getContexts(context, tag, false).length == 0) {
    return {
      key_id: key.key_id,
      key_name: keyName,
      tags: removeFromArraySet(key.tags ?? [], tag),
      context: context,
    }
  } else {
    return {
      key_id: key.key_id,
      key_name: keyName,
      platforms: addToArraySet(key.platforms ?? [], platform),
      tags: addToArraySet(key.tags ?? [], tag),
      context: context,
    }
  }
}

function createNewKeyData(platform: SupportedPlatforms, tag: string, keyEntry: KeyEntry): CreateKeyData {
  return {
    key_name: keyEntry.key,
    is_plural: keyEntry.isPlural,
    platforms: [platform],
    tags: [tag],
    context: addContext(undefined, tag, keyEntry.context),
  }
}

function appendTranslation(key: CreateKeyData | UpdateKeyDataWithId, translation: TranslationData) {
  if (key.translations == null) {
    key.translations = [translation]
  } else {
    key.translations.push(translation)
  }
}

function keyHasTranslation(key: Key | CreateKeyData, locale: string): boolean {
  if (key.translations == null) {
    return false
  }
  return key.translations.some(tr => tr.language_iso == locale)
}

function createTranslationData(locale: string, isPlural: boolean, messages: TransMessages): TranslationData {
  if (isPlural) {
    return {
      language_iso: locale,
      translation: messages,
      is_unverified: true,
    }
  } else {
    return {
      language_iso: locale,
      translation: messages['other'],
      is_unverified: true,
    }
  }
}

function updateKeyData(
  platform: SupportedPlatforms,
  tag: string,
  keyEntries: KeyEntry[],
  allTransEntries: { [locale: string]: TransEntry[] },
  listedKeyMap: { [keyName: string]: Key },
): {
  creatingKeyMap: { [keyName: string]: CreateKeyData },
  updatingKeyMap: { [keyName: string]: UpdateKeyDataWithId },
} {
  const keys = EntryCollection.loadEntries(keyEntries)
  // 새로 만들 키
  const creatingKeyMap: { [keyName: string]: CreateKeyData } = {}
  // 기존 키에서 업데이트할 부분
  const updatingKeyMap: { [keyName: string]: UpdateKeyDataWithId } = {}

  for (const keyName of Object.keys(listedKeyMap)) {
    const key = updatingKeyMap[keyName] ?? listedKeyMap[keyName]
    if (!key.tags?.includes(tag)) {
      continue
    }
    for (const keyContext of getContexts(key.context, tag, true)) {
      const keyEntry = keys.find(keyContext, keyName)
      if (keyEntry == null) {
        updatingKeyMap[keyName] = createUpdateKeyDataByRemoving(platform, tag, key, keyName, keyContext)
      }
    }
  }

  for (const keyEntry of keyEntries) {
    // 로컬에서 추출한 pot 에서 (pot 에는 번역은 없고 msgid 만 있음)
    const entryKey = keyEntry.key
    const key = updatingKeyMap[entryKey] ?? listedKeyMap[entryKey]
    if (key != null) {
      // 기존 키는 있는데
      if (!key.tags?.includes(tag) ||
        !key.platforms?.includes(platform) ||
        !containsContext(key.context, tag, keyEntry.context) ||
        !containsComment(key.description, tag, keyEntry.comments)
      ) {
        // 태그, 플랫폼, context 가 없으면 업데이트
        updatingKeyMap[entryKey] = createUpdateKeyDataByAddingKeyEntry(platform, tag, key, keyEntry)
      }
    } else {
      // 기존 키 자체가 없으면 새로 키 만들기
      creatingKeyMap[entryKey] = createNewKeyData(platform, tag, keyEntry)
    }
  }

  for (const [locale, transEntries] of Object.entries(allTransEntries)) {
    // console.log('update sheet locale', locale)
    for (const transEntry of transEntries) {
      // 로케일별 po 에서 (po 에는 번역도 있음)
      const entryKey = transEntry.key
      // console.log('update sheet entry key', entryKey)
      // console.log('matched entry (locale)', locale)
      // console.log('po entry', poEntry)

      const key = listedKeyMap[entryKey]
      if (key != null) {
        // 기존 키는 있는데
        if (transEntry.messages['other'] && !keyHasTranslation(key, locale)) {
          // 기존 키에 로컬 번역은 있는데, lokalise 에 번역이 있는 경우 unverified 상태로 넣어줌
          let updatingKey = updatingKeyMap[entryKey]
          if (updatingKey == null) {
            updatingKey = createUpdateKeyDataByAddingTransEntry(platform, tag, key, transEntry)
            updatingKeyMap[entryKey] = updatingKey
          }
          appendTranslation(updatingKey, createTranslationData(locale, key.is_plural, transEntry.messages))
        }
      } else {
        const creatingKey = creatingKeyMap[entryKey]
        if (creatingKey != null) {
          // 새로 만들 키에 번역 추가 (unverified)
          if (transEntry.messages['other'] && !keyHasTranslation(creatingKey, locale)) {
            appendTranslation(creatingKey, createTranslationData(locale, creatingKey.is_plural == true, transEntry.messages))
          }
        }
      }
    }
  }
  // console.log('updated sheet data', sheetData)
  return { creatingKeyMap, updatingKeyMap }
}

function updateTransEntries(
  tag: string,
  config: LokaliseConfig,
  keyEntries: KeyEntry[],
  allTransEntries: { [locale: string]: TransEntry[] },
  listedKeyMap: { [keyName: string]: Key },
) {
  const skipNotReviewed = config.skipNotReviewed()
  for (const [keyName, key] of Object.entries(listedKeyMap)) {
    for (const tr of key.translations) {
      const locale = tr.language_iso
      const useUnverified = config.useUnverified(locale)
      // lokalise 에 있는 번역에 대해서
      if (allTransEntries[locale] != null) {
        // 해당 언어 번역이 있는 경우
        const trans = EntryCollection.loadEntries(allTransEntries[locale])
        const transEntries: TransEntry[] = []
        for (const keyContext of [...getContexts(key.context, tag, false), null]) {
          const transEntry = trans.find(keyContext, keyName)
          if (transEntry) {
            transEntries.push(transEntry)
          }
        }

        for (const transEntry of transEntries) {
          // console.log('updating po, sheet entry', sheetEntry)
          // console.log('updating po, po', po)
          const entryKey = transEntry.key
          // console.log('updating po, po entry', poEntry)
          if (tr.is_unverified) {
            transEntry.flag = 'unverified'
          } else if (!tr.is_reviewed) {
            transEntry.flag = 'not_reviewed'
          } else {
            transEntry.flag = null
          }

          function updateIfNotSkipped(update: () => void) {
            if (skipNotReviewed && !tr.is_reviewed) {
              log.info('updateTransEntries', `skipping not reviewed: ${locale} of ${entryKey}`)
              return
            }
            if (!useUnverified && tr.is_unverified) {
              log.info('updateTransEntries', `skipping unverified: ${locale} of ${entryKey}`)
              return
            }
            update()
          }

          if (tr.translation) {
            if (key.is_plural) {
              try {
                const translations = pickBy(JSON.parse(tr.translation), value => !!value)
                if (!isEqual(transEntry.messages, translations)) {
                  updateIfNotSkipped(() => {
                    log.verbose('updateTransEntries', `updating ${locale} value of ${entryKey}: ${JSON.stringify(transEntry.messages)} -> ${tr.translation}`)
                    transEntry.messages = translations
                  })
                }
              } catch (err) {
                log.warn('updateTransEntries', `cannot parse translation object: ${tr.translation}`, err)
              }
            } else {
              if (tr.translation !== transEntry.messages['other']) {
                updateIfNotSkipped(() => {
                  log.verbose('updateTransEntries', `updating ${locale} value of ${entryKey}: ${transEntry.messages['other']} -> ${tr.translation}`)
                  transEntry.messages = { other: tr.translation }
                })
              }
            }
          }
        }
      }
    }
  }
  // console.log('updated po data', JSON.stringify(poData, null, 2))
}

async function uploadToLokalise(
  lokaliseApi: LokaliseApi,
  projectId: string,
  tag: string,
  config: LokaliseConfig,
  creatingKeyMap: { [keyName: string]: CreateKeyData },
  updatingKeyMap: { [keyName: string]: UpdateKeyDataWithId },
  drySync: boolean,
) {
  const localeSyncMap = config.getLocaleSyncMap(false)
  const prefixes = config.getPureKeyPrefixes()
  for (let keys of chunk(Object.values(creatingKeyMap), 500)) {
    try {
      keys = keys.map(key => applyLocaleSyncMap(key, localeSyncMap))
      const fillLocale = config.fillKeyToLocale()
      if (fillLocale != null) {
        keys = keys.map(key => {
          if (isPureKey(key.key_name as string, prefixes)) {
            return key
          }
          if (!key.translations?.some(translation => translation.language_iso == fillLocale)) {
            if (!key.translations) {
              key.translations = []
            }
            key.translations.push(createTranslationData(fillLocale, key.is_plural == true, { other: key.key_name as string }))
          }
          return key
        })
      }
      if (drySync) {
        log.notice('drySync', 'creating keys', JSON.stringify(keys, undefined, 2))
      } else {
        log.notice('lokaliseApi', 'creating keys...', keys.length)
        await lokaliseApi.keys().create({
          keys: keys,
          use_automations: true,
        }, {
          project_id: projectId,
        })
      }
      log.info('lokaliseApi', 'created key count', keys.length)
    } catch (err) {
      log.error('lokaliseApi', 'creating keys failed', err)
      throw err
    }
  }

  for (let keys of chunk(Object.values(updatingKeyMap), 500)) {
    try {
      keys = keys.map(key => applyLocaleSyncMap(key, localeSyncMap))
      if (drySync) {
        log.notice('drySync', 'updating keys', JSON.stringify(keys, undefined, 2))
      } else {
        log.notice('lokaliseApi', 'updating keys...', keys.length)
        await lokaliseApi.keys().bulk_update({
          keys: keys,
          use_automations: true,
        }, {
          project_id: projectId,
        })
      }
      log.info('lokaliseApi', 'updated key count', keys.length)
    } catch (err) {
      log.error('lokaliseApi', 'updating keys failed', err)
      throw err
    }
  }
}

function applyLocaleSyncMap<T extends CreateKeyData | UpdateKeyDataWithId>(
  key: T,
  localeSyncMap: { [locale: string]: string } | undefined,
): T {
  if (key.translations == null || localeSyncMap == null) {
    return key
  }
  return {
    ...key,
    translations: key.translations.map(tr => {
      if (!tr.language_iso) {
        return tr
      }
      return {
        ...tr,
        language_iso: localeSyncMap[tr.language_iso] ?? tr.language_iso,
      }
    }),
  }
}
