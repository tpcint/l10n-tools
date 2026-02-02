import type { L10nPlugin } from 'l10n-tools-core'
import { extractVueGettextKeys, extractVueI18nKeys } from './extractor.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-extractor-vue',
  extractors: [{
    domainTypes: ['vue-gettext', 'vue-i18n'],
    extractor: async (domainName, config, keysPath) => {
      const type = config.getType()
      if (type === 'vue-gettext') {
        return extractVueGettextKeys(domainName, config, keysPath)
      } else {
        return extractVueI18nKeys(domainName, config, keysPath)
      }
    },
  }],
}

export default () => plugin
