import type { L10nPlugin } from 'l10n-tools-core'
import { extractPhpKeys } from './extractor.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-extractor-php',
  extractors: [{
    domainTypes: ['php-gettext'],
    extractor: extractPhpKeys,
  }],
}

export default () => plugin
