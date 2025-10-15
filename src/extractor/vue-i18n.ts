import type { DomainConfig } from '../config.js'
import fsp from 'node:fs/promises'
import log from 'npmlog'
import path from 'node:path'
import { getSrcPaths } from '../common.js'
import { KeyCollector } from '../key-collector.js'
import { TsExtractor } from './ts-extractor.js'
import { writeKeyEntries } from '../entry.js'

export default async function (domainName: string, config: DomainConfig, keysPath: string) {
  const srcPaths = await getSrcPaths(config, ['.vue', '.js', '.ts'])
  const keywords = new Set(config.getKeywords())
  keywords.add('$t:0:2')
  keywords.add('t:0:2')
  keywords.add('vm.$t:0:2')
  keywords.add('this.$t:0:2')
  keywords.add('app.i18n.t:0:2')
  keywords.add('$tc:0:1')
  keywords.add('tc:0:1')
  keywords.add('vm.$tc:0:1')
  keywords.add('this.$tc:0:1')
  keywords.add('app.i18n.tc:0:1')

  const collector = new KeyCollector({
    tagNames: ['i18n', 'i18n-t'],
    objectAttrs: { 'v-t': ['', 'path'] },
    exprAttrs: [/^:/, /^v-bind:/, /^v-html$/],
    markers: [{ start: '{{', end: '}}' }],
    keywords: [...keywords],
  })
  const extractor = new TsExtractor(collector)
  log.info('extractKeys', 'extracting from .vue, .js, .ts files')
  for (const srcPath of srcPaths) {
    log.verbose('extractKeys', `processing '${srcPath}'`)
    const ext = path.extname(srcPath)
    if (ext === '.vue') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractVue(srcPath, input)
    } else if (ext === '.js') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractJsModule(srcPath, input)
    } else if (ext === '.ts') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractTsModule(srcPath, input)
    } else {
      log.warn('extractKeys', `skipping '${srcPath}': unknown extension`)
    }
  }
  await writeKeyEntries(keysPath, collector.getEntries())
}
