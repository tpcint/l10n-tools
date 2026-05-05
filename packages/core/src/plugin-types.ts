import type { CompilerConfig, DomainConfig, L10nConfig } from './config.js'
import type { KeyEntry, TransEntry, TransMessages } from './entry.js'

/**
 * Extractor function signature
 * Extracts translation keys from source files
 */
export type ExtractorFunc = (
  domainName: string,
  domainConfig: DomainConfig,
  keysPath: string,
) => Promise<void>

/**
 * Extractor plugin definition
 */
export interface ExtractorPlugin {
  /** Domain types this extractor supports (e.g., 'android', 'ios', 'vue-gettext') */
  domainTypes: string[],
  /** The extractor function */
  extractor: ExtractorFunc,
}

/**
 * Compiler function signature
 * Compiles translations to platform-specific formats
 */
export type CompilerFunc = (
  domainName: string,
  config: CompilerConfig,
  transDir: string,
) => Promise<void>

/**
 * Compiler plugin definition
 */
export interface CompilerPlugin {
  /** Compiler types this plugin supports (e.g., 'android', 'json', 'mo') */
  compilerTypes: string[],
  /** Map of compiler type to function */
  compilers: Record<string, CompilerFunc>,
}

/**
 * Options for syncer functions
 */
export interface SyncerOptions {
  /** Additional tags to apply when creating keys */
  additionalTags?: string[],
  /** Global metadata (tag=null) to apply when creating keys */
  globalMetadata?: Record<string, string>,
  /** Tag-specific metadata to apply when creating keys */
  tagMetadata?: Record<string, string>,
  /** Source identifier for tag ownership (l10n-storage) */
  source?: string,
}

/**
 * Syncer function signature
 * Synchronizes translations with external services
 */
export type SyncerFunc = (
  config: L10nConfig,
  domainConfig: DomainConfig,
  tag: string,
  keyEntries: KeyEntry[],
  allTransEntries: Record<string, TransEntry[]>,
  skipUpload: boolean,
  options?: SyncerOptions,
) => Promise<void>

/**
 * Snapshot of a key fetched from the sync target, used by source-filtering features
 * (e.g., `check --source` and `_compile --source`). Locale codes are local-side
 * (after applying any locale sync map).
 */
export interface SyncerKeySnapshot {
  keyName: string,
  isPlural: boolean,
  /** Contexts the key is associated with under this tag. Always at least one entry. */
  contexts: (string | null)[],
  /** Translations keyed by local locale code. */
  translations: { [locale: string]: TransMessages },
}

/**
 * Optional capability: fetch keys narrowed by tag (and optionally source).
 * Implemented by syncers whose backend supports source/tag-based filtering
 * (currently l10n-storage).
 */
export type SyncerSourceFilterFunc = (
  config: L10nConfig,
  domainConfig: DomainConfig,
  tag: string,
  source: string | undefined,
) => Promise<SyncerKeySnapshot[]>

/**
 * Syncer plugin definition
 */
export interface SyncerPlugin {
  /** Sync target name (e.g., 'lokalise') */
  syncTarget: string,
  /** The syncer function */
  syncer: SyncerFunc,
  /** Optional: fetch keys narrowed by (tag, source). */
  sourceFilter?: SyncerSourceFilterFunc,
}

/**
 * Combined plugin interface
 * A plugin can provide any combination of extractors, compilers, and syncers
 */
export interface L10nPlugin {
  /** Plugin name for identification */
  name: string,
  /** Extractors provided by this plugin */
  extractors?: ExtractorPlugin[],
  /** Compilers provided by this plugin */
  compilers?: CompilerPlugin[],
  /** Syncers provided by this plugin */
  syncers?: SyncerPlugin[],
}

/**
 * Plugin factory function type
 * Default export of plugin packages should be this type
 */
export type PluginFactory = () => L10nPlugin | Promise<L10nPlugin>
