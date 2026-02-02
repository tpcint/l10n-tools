import log from 'npmlog'
import fsp from 'node:fs/promises'
import * as path from 'path'
import { type DomainConfig, getSrcPaths, writeKeyEntries } from 'l10n-tools-core'
import { KeyExtractor } from './key-extractor.js'

export async function extractJavaScriptKeys(domainName: string, config: DomainConfig, keysPath: string) {
  const srcPaths = await getSrcPaths(config, ['.js', '.ts', '.jsx', '.tsx'])
  const keywords = config.getKeywords()

  const extractor = new KeyExtractor({ keywords })
  log.info('extractKeys', 'extracting from .js, .ts files')
  for (const srcPath of srcPaths) {
    log.verbose('extractKeys', `processing '${srcPath}'`)
    const ext = path.extname(srcPath)
    if (ext === '.js') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractJsModule(srcPath, input)
    } else if (ext === '.ts') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractTsModule(srcPath, input)
    } else if (ext === '.jsx') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractJsxModule(srcPath, input)
    } else if (ext === '.tsx') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractTsxModule(srcPath, input)
    } else {
      log.warn('extractKeys', `skipping '${srcPath}': unknown extension`)
    }
  }
  await writeKeyEntries(keysPath, extractor.keys.toEntries())
}
