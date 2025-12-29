import fsp from 'node:fs/promises'
import log from 'npmlog'
import * as path from 'path'
import { getSrcPaths } from '../common.js'
import { KeyExtractor } from '../key-extractor.js'
import type { DomainConfig, SessionConfig } from '../config.js'
import { writeKeyEntries } from '../entry.js'

export default async function (domainName: string, config: DomainConfig, sessionConfig: SessionConfig) {
  const keysPath = sessionConfig.getKeysPath()
  const srcPaths = await getSrcPaths(config, ['.php'], sessionConfig.getFiles())
  const keywords = new Set(config.getKeywords())
  keywords.add('_')
  keywords.add('gettext')

  const extractor = new KeyExtractor({
    keywords: keywords,
  })
  log.info('extractKeys', 'extracting from .php files')
  for (const srcPath of srcPaths) {
    log.verbose('extractKeys', `processing '${srcPath}'`)
    const ext = path.extname(srcPath)
    if (ext === '.php') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractPhpCode(srcPath, input)
    } else {
      log.warn('extractKeys', `skipping '${srcPath}': unknown extension`)
    }
  }
  await writeKeyEntries(keysPath, extractor.keys.toEntries())
}
