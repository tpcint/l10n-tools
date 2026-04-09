import type { L10nPlugin } from 'l10n-tools-core'
import { syncTransToL10nStorage } from './l10n-storage.js'

const plugin: L10nPlugin = {
  name: 'l10n-tools-syncer-l10n-storage',
  syncers: [{
    syncTarget: 'l10n-storage',
    syncer: syncTransToL10nStorage,
  }],
}

export default () => plugin
