import type { L10nPlugin } from 'l10n-tools-core'
import { extractJavaScriptKeys } from './extractor.js'

// Export JsKeyExtractor for use by other extractors (e.g., extractor-vue)
export { JsKeyExtractor } from './js-key-extractor.js'
export { getLineTo } from 'l10n-tools-core'
export type { JsKeyExtractorOptions } from './js-key-extractor.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-extractor-javascript',
  extractors: [{
    domainTypes: ['react', 'javascript', 'typescript', 'i18next'],
    extractor: extractJavaScriptKeys,
  }],
}

export default () => plugin
