import type { L10nPlugin } from 'l10n-tools-core'
import { compileToJson, compileToJsonDir } from './compiler.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-compiler-json',
  compilers: [{
    compilerTypes: ['json', 'vue-gettext', 'json-dir', 'vue-i18n', 'node-i18n', 'i18next'],
    compilers: {
      'json': compileToJson,
      'vue-gettext': compileToJson,
      'json-dir': compileToJsonDir(),
      'vue-i18n': compileToJsonDir('vue-i18n'),
      'node-i18n': compileToJsonDir('node-i18n'),
      'i18next': compileToJsonDir('i18next'),
    },
  }],
}

export default () => plugin
