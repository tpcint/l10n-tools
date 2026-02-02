// Plugin types and registry
export type {
  L10nPlugin,
  PluginFactory,
  ExtractorPlugin,
  ExtractorFunc,
  CompilerPlugin,
  CompilerFunc,
  SyncerPlugin,
  SyncerFunc,
} from './plugin-types.js'

export { pluginRegistry } from './plugin-registry.js'

// Configuration
export {
  L10nConfig,
  DomainConfig,
  CompilerConfig,
  LokaliseConfig,
  type DomainType,
  type CompilerType,
  type SyncTarget,
} from './config.js'

// Entry types and utilities
export {
  type KeyEntry,
  type TransEntry,
  type TransMessages,
  type KeyReference,
  readKeyEntries,
  readTransEntries,
  readAllTransEntries,
  writeKeyEntries,
  writeTransEntries,
  writeAllTransEntries,
  checkTransEntrySpecs,
  getPluralKeys,
} from './entry.js'

export { EntryCollection } from './entry-collection.js'
export { KeyEntryBuilder } from './key-entry-builder.js'
export { BaseKeyExtractor, getLineTo } from './key-extractor-base.js'
export { getElementContent, getElementContentIndex } from './element-utils.js'

// Utilities
export {
  fileExists,
  getKeysPath,
  getTransPath,
  listTransPaths,
  extractLocaleFromTransPath,
  isErrnoException,
  getTempDir,
  execWithLog,
} from './utils.js'

export { updateTrans, getSrcPaths } from './common.js'

// Extractor, compiler, syncer functions
export { extractKeys } from './extractor/index.js'
export { compileAll } from './compiler/index.js'
export { syncTransToTarget } from './syncer/index.js'
