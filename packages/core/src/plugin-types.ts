import type { CompilerConfig, DomainConfig, L10nConfig } from './config.js'
import type { KeyEntry, TransEntry } from './entry.js'

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
  additionalTags?: string[],
) => Promise<void>

/**
 * Syncer plugin definition
 */
export interface SyncerPlugin {
  /** Sync target name (e.g., 'lokalise') */
  syncTarget: string,
  /** The syncer function */
  syncer: SyncerFunc,
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
