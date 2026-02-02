import type { DomainConfig, L10nConfig } from '../config.js'
import { readAllTransEntries, readKeyEntries, writeAllTransEntries, writeKeyEntries } from '../entry.js'
import { pluginRegistry } from '../plugin-registry.js'

export type { SyncerFunc } from '../plugin-types.js'

/**
 * Synchronize translations with the configured sync target.
 *
 * @param config - The l10n configuration
 * @param domainConfig - Configuration object describing the domain
 * @param tag - Tag for the sync operation
 * @param keysPath - Path to the keys file
 * @param transDir - Directory containing translation files
 * @param drySync - If true, simulate sync without making changes
 * @param additionalTags - Additional tags to apply
 */
export async function syncTransToTarget(
  config: L10nConfig,
  domainConfig: DomainConfig,
  tag: string,
  keysPath: string,
  transDir: string,
  drySync: boolean,
  additionalTags?: string[],
) {
  const target = config.getSyncTarget()

  const syncer = pluginRegistry.getSyncer(target)
  if (!syncer) {
    const suggestedPlugin = pluginRegistry.getSuggestedSyncerPlugin(target)
    const installHint = suggestedPlugin
      ? `\nInstall the required plugin: npm install ${suggestedPlugin}`
      : ''
    throw new Error(`No syncer found for target: ${target}${installHint}`)
  }

  const keyEntries = await readKeyEntries(keysPath)
  const allTransEntries = await readAllTransEntries(transDir)
  await syncer(config, domainConfig, tag, keyEntries, allTransEntries, drySync, additionalTags)
  await writeKeyEntries(keysPath, keyEntries)
  await writeAllTransEntries(transDir, allTransEntries)
}
