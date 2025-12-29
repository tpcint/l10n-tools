import fsp from 'node:fs/promises'
import log from 'npmlog'
import * as path from 'path'
import { getSrcPaths } from '../common.js'
import { KeyExtractor } from '../key-extractor.js'
import type { DomainConfig } from '../config.js'
import { writeKeyEntries } from '../entry.js'

export default async function (domainName: string, config: DomainConfig, keysPath: string) {
  const srcPaths = await getSrcPaths(config, ['.vue', '.js'])
  const keywords = new Set(config.getKeywords())
  keywords.add('$gettext')
  keywords.add('this.$gettext')
  keywords.add('vm.$gettext')
  keywords.add('$gettextInterpolate')
  keywords.add('this.$gettextInterpolate')
  keywords.add('vm.$gettextInterpolate')

  const extractor = new KeyExtractor({
    tagNames: ['translate'],
    attrNames: ['v-translate'],
    exprAttrs: [/^:/, /^v-bind:/],
    markers: [{ start: '{{', end: '}}' }],
    keywords: keywords,
  })
  log.info('extractKeys', 'extracting from .vue, .js files')
  for (const srcPath of srcPaths) {
    log.verbose('extractKeys', `processing '${srcPath}'`)
    const ext = path.extname(srcPath)
    if (ext === '.vue') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractVue(srcPath, input)
    } else if (ext === '.js') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractJsModule(srcPath, input)
    } else {
      log.warn('extractKeys', `skipping '${srcPath}': unknown extension`)
    }
  }
  await writeKeyEntries(keysPath, extractor.keys.toEntries())
}
