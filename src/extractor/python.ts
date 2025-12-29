import log from 'npmlog'
import { getSrcPaths, xgettext } from '../common.js'
import type { DomainConfig, SessionConfig } from '../config.js'

export default async function (domainName: string, config: DomainConfig, _sessionConfig: SessionConfig) {
  throw new Error('python extractor is not yet updated to new intermediate format')
  const potPath = ''
  const srcPaths = await getSrcPaths(config, ['.py'])
  const keywords = config.getKeywords()
  log.info('extractPot', 'extracting from .py files')
  await xgettext(domainName, 'Python', keywords, potPath, srcPaths, false)
}
