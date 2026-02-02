import * as path from 'path'
import fsp from 'node:fs/promises'
import type { DomainConfig } from '../config.js'
import { pluginRegistry } from '../plugin-registry.js'

export type { ExtractorFunc } from '../plugin-types.js'

/**
 * Extracts translation keys for the specified domain and writes them to the provided keys path.
 *
 * @param domainName - The domain identifier to extract keys from
 * @param domainConfig - Configuration object describing the domain (type and related settings)
 * @param keysPath - Filesystem path where the extracted keys file will be created or updated
 */
export async function extractKeys(domainName: string, domainConfig: DomainConfig, keysPath: string) {
  const type = domainConfig.getType()
  await fsp.mkdir(path.dirname(keysPath), { recursive: true })

  const extractor = pluginRegistry.getExtractor(type)
  if (!extractor) {
    const suggestedPlugin = pluginRegistry.getSuggestedPlugin(type)
    const installHint = suggestedPlugin
      ? `\nInstall the required plugin: npm install ${suggestedPlugin}`
      : ''
    throw new Error(`No extractor found for domain type: ${type}${installHint}`)
  }

  await extractor(domainName, domainConfig, keysPath)
}
