import log from 'npmlog'
import type { DomainConfig } from 'l10n-tools-core'

export async function extractPythonKeys(_domainName: string, _config: DomainConfig, _keysPath: string) {
  log.warn('extractKeys', 'Python extractor is not yet updated to new intermediate format')
  throw new Error('python extractor is not yet updated to new intermediate format')
}
