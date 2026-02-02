import type { L10nPlugin } from 'l10n-tools-core'
import { extractJavaScriptKeys } from './extractor.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-extractor-javascript',
  extractors: [{
    domainTypes: ['react', 'javascript', 'typescript', 'i18next'],
    extractor: extractJavaScriptKeys,
  }],
}

export default () => plugin
