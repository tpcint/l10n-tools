import type { L10nPlugin } from 'l10n-tools-core'
import { extractIosKeys } from './extractor.js'
import { compileToIosStrings } from './compiler.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-plugin-ios',
  extractors: [{
    domainTypes: ['ios'],
    extractor: extractIosKeys,
  }],
  compilers: [{
    compilerTypes: ['ios'],
    compilers: {
      ios: compileToIosStrings,
    },
  }],
}

export default () => plugin
