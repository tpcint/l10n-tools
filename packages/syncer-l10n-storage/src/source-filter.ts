import { invert } from 'es-toolkit/compat'
import type { DomainConfig, L10nConfig, SyncerKeySnapshot, TransMessages, TransPluralKey } from 'l10n-tools-core'
import { L10nStorageApiClient } from './api-client.js'
import type { L10nKeyToServe } from './api-types.js'
import { getContextsFromMetadata } from './metadata.js'

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

/** @internal exported for testing */
export function toSnapshot(
  key: L10nKeyToServe,
  tag: string,
  invertedSyncMap: { [locale: string]: string } | undefined,
): SyncerKeySnapshot {
  const contexts: (string | null)[] = getContextsFromMetadata(key.metadata, tag)
  if (contexts.length === 0) contexts.push(null)

  const translations: { [locale: string]: TransMessages } = {}
  for (const tr of key.translations) {
    const locale = invertedSyncMap?.[tr.locale] ?? tr.locale
    let messages: TransMessages
    if (key.isPlural) {
      const m: TransMessages = {}
      for (const [form, value] of Object.entries(tr.translation)) {
        if (value) m[form as TransPluralKey] = value
      }
      messages = m
    } else {
      const v = tr.translation.other
      messages = v ? { other: v } : {}
    }
    translations[locale] = messages
  }

  return {
    keyName: key.keyName,
    isPlural: key.isPlural,
    contexts,
    translations,
  }
}

export async function sourceFilterForL10nStorage(
  config: L10nConfig,
  _domainConfig: DomainConfig,
  tag: string,
  source: string | undefined,
): Promise<SyncerKeySnapshot[]> {
  const storageConfig = config.getL10nStorageConfig()
  const projectId = storageConfig.getProjectId()
  const url = storageConfig.getUrl()

  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN environment variable is required')
  }

  const localeSyncMap = storageConfig.getLocaleSyncMap()
  if (localeSyncMap) assertBijectiveLocaleSyncMap(localeSyncMap)
  const invertedSyncMap = localeSyncMap ? invert(localeSyncMap) : undefined

  const apiClient = new L10nStorageApiClient(url, token)
  const keys = await apiClient.listKeysToServeByTag(projectId, tag, source)
  return keys.map(key => toSnapshot(key, tag, invertedSyncMap))
}
