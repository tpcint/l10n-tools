import type { L10nPlugin } from 'l10n-tools-core'
import { compileToMo, compileToPoJson, readMoOutputKeys, readPoJsonOutputKeys } from './compiler.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-compiler-gettext',
  compilers: [{
    compilerTypes: ['po-json', 'mo', 'python', 'node-gettext'],
    compilers: {
      'po-json': compileToPoJson,
      'mo': compileToMo,
      'python': compileToMo,
      'node-gettext': compileToPoJson,
    },
    outputKeyReaders: {
      'po-json': readPoJsonOutputKeys(),
      'mo': readMoOutputKeys(),
      'python': readMoOutputKeys(),
      'node-gettext': readPoJsonOutputKeys(),
    },
  }],
}

export default () => plugin
