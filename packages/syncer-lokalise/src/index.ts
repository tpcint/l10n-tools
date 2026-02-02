import type { L10nPlugin } from 'l10n-tools-core'
import { syncTransToLokalise } from './lokalise.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-syncer-lokalise',
  syncers: [{
    syncTarget: 'lokalise',
    syncer: syncTransToLokalise,
  }],
}

export default () => plugin
