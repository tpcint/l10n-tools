import type { L10nPlugin } from 'l10n-tools-core'
import { extractAndroidKeys } from './extractor.js'
import { compileToAndroidXml } from './compiler.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-plugin-android',
  extractors: [{
    domainTypes: ['android'],
    extractor: extractAndroidKeys,
  }],
  compilers: [{
    compilerTypes: ['android'],
    compilers: {
      android: compileToAndroidXml,
    },
  }],
}

export default () => plugin
