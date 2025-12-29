import * as path from 'path'
import fsp from 'node:fs/promises'
import type { DomainConfig, DomainType, SessionConfig } from '../config.js'

export type ExtractorFunc = (domainName: string, domainConfig: DomainConfig, sessionConfig: SessionConfig) => Promise<void>

export async function extractKeys(domainName: string, domainConfig: DomainConfig, sessionConfig: SessionConfig) {
  const type = domainConfig.getType()
  await fsp.mkdir(path.dirname(sessionConfig.getKeysPath()), { recursive: true })
  const extractor = await loadExtractor(type)
  await extractor(domainName, domainConfig, sessionConfig)
}

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
