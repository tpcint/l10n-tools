import * as path from 'path'
import fsp from 'node:fs/promises'
import type { DomainConfig, DomainType } from '../config.js'

export type ExtractorFunc = (domainName: string, domainConfig: DomainConfig, keysPath: string) => Promise<void>

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
  const extractor = await loadExtractor(type)
  await extractor(domainName, domainConfig, keysPath)
}

/**
 * Load the extractor implementation for a given domain type.
 *
 * @param type - Domain type that selects which extractor module to import (for example 'vue-gettext', 'vue-i18n', 'react', 'javascript', 'typescript', 'i18next', 'python', 'android', 'ios', 'php-gettext')
 * @returns The extractor function corresponding to `type`
 * @throws Error if `type` is not a recognized domain type
 */
async function loadExtractor(type: DomainType): Promise<ExtractorFunc> {
  switch (type) {
    case 'vue-gettext':
      return (await import('./vue-gettext.js')).default
    case 'vue-i18n':
      return (await import('./vue-i18n.js')).default
    case 'react':
    case 'javascript':
    case 'typescript':
    case 'i18next':
      return (await import('./javascript.js')).default
    case 'python':
      return (await import('./python.js')).default
    case 'android':
      return (await import('./android.js')).default
    case 'ios':
      return (await import('./ios.js')).default
    case 'php-gettext':
      return (await import('./php-gettext.js')).default
  }
  throw new Error(`unknown domain type: ${type}`)
}