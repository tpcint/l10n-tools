import log from 'npmlog'
import type { DomainConfig } from 'l10n-tools-core'

export async function extractPythonKeys(domainName: string, config: DomainConfig, keysPath: string) {
  log.warn('extractKeys', 'Python extractor is not yet updated to new intermediate format')
  throw new Error('python extractor is not yet updated to new intermediate format')
}
