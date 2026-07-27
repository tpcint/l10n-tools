import log from 'npmlog'
import type { DomainConfig } from 'l10n-tools-core'

// ExtractorFunc 시그니처를 맞추기 위해 async를 유지한다.
// oxlint-disable-next-line typescript/require-await
export async function extractPythonKeys(_domainName: string, _config: DomainConfig, _keysPath: string) {
  log.warn('extractKeys', 'Python extractor is not yet updated to new intermediate format')
  throw new Error('python extractor is not yet updated to new intermediate format')
}
