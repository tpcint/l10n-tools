import type { DomainConfig, L10nConfig, SyncTarget } from '../config.js'
import {
  type KeyEntry,
  readAllTransEntries,
  readKeyEntries,
  type TransEntry,
  writeAllTransEntries,
  writeKeyEntries,
} from '../entry.js'

export type SyncerFunc = (config: L10nConfig, domainConfig: DomainConfig, tag: string, keyEntries: KeyEntry[], allTransEntries: { [locale: string]: TransEntry[] }, drySync: boolean) => Promise<void>

export async function syncTransToTarget(config: L10nConfig, domainConfig: DomainConfig, tag: string, keysPath: string, transDir: string, drySync: boolean) {
  const target = config.getSyncTarget()
  const syncer = await loadSyncer(target)
  const keyEntries = await readKeyEntries(keysPath)
  const allTransEntries = await readAllTransEntries(transDir)
  await syncer(config, domainConfig, tag, keyEntries, allTransEntries, drySync)
  await writeKeyEntries(keysPath, keyEntries)
  await writeAllTransEntries(transDir, allTransEntries)
}

async function loadSyncer(target: SyncTarget): Promise<SyncerFunc> {
  switch (target) {
    case 'lokalise':
      return (await import('./lokalise.js')).syncTransToLokalise
  }
  throw new Error(`unknown sync target: ${target}`)
}
