import type { L10nPlugin } from 'l10n-tools-core'
import { extractPythonKeys } from './extractor.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-extractor-python',
  extractors: [{
    domainTypes: ['python'],
    extractor: extractPythonKeys,
  }],
}

export default () => plugin
