import log from 'npmlog'
import type {
  L10nPlugin,
  PluginFactory,
  ExtractorFunc,
  CompilerFunc,
  SyncerFunc,
} from './plugin-types.js'

/**
 * Known plugin packages for auto-discovery
 */
const KNOWN_PLUGINS = [
  'l10n-tools-plugin-android',
  'l10n-tools-plugin-ios',
  'l10n-tools-extractor-javascript',
  'l10n-tools-extractor-vue',
  'l10n-tools-extractor-python',
  'l10n-tools-extractor-php',
  'l10n-tools-compiler-json',
  'l10n-tools-compiler-gettext',
  'l10n-tools-syncer-lokalise',
] as const

/**
 * Mapping from domain/compiler types to suggested plugin packages
 */
const TYPE_TO_PLUGIN: Record<string, string> = {
  // Extractors (domain types)
  'android': 'l10n-tools-plugin-android',
  'ios': 'l10n-tools-plugin-ios',
  'react': 'l10n-tools-extractor-javascript',
  'javascript': 'l10n-tools-extractor-javascript',
  'typescript': 'l10n-tools-extractor-javascript',
  'i18next': 'l10n-tools-extractor-javascript',
  'vue-gettext': 'l10n-tools-extractor-vue',
  'vue-i18n': 'l10n-tools-extractor-vue',
  'python': 'l10n-tools-extractor-python',
  'php-gettext': 'l10n-tools-extractor-php',
  // Compilers
  'json': 'l10n-tools-compiler-json',
  'json-dir': 'l10n-tools-compiler-json',
  'vue-i18n-compiler': 'l10n-tools-compiler-json',
  'node-i18n': 'l10n-tools-compiler-json',
  'i18next-compiler': 'l10n-tools-compiler-json',
  'po-json': 'l10n-tools-compiler-gettext',
  'mo': 'l10n-tools-compiler-gettext',
  'node-gettext': 'l10n-tools-compiler-gettext',
  // Syncers
  'lokalise': 'l10n-tools-syncer-lokalise',
}

/**
 * Plugin registry for managing extractors, compilers, and syncers
 */
class PluginRegistry {
  private plugins = new Map<string, L10nPlugin>()
  private extractors = new Map<string, ExtractorFunc>()
  private compilers = new Map<string, CompilerFunc>()
  private syncers = new Map<string, SyncerFunc>()
  private initialized = false

  /**
   * Initialize the registry by discovering and loading plugins
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Auto-discover known plugins
    for (const pluginName of KNOWN_PLUGINS) {
      try {
        await this.loadPlugin(pluginName)
      } catch {
        // Plugin not installed - this is expected
        log.verbose('plugin-registry', `Plugin ${pluginName} not installed`)
      }
    }

    this.initialized = true
    log.verbose('plugin-registry', `Loaded ${this.plugins.size} plugins`)
  }

  /**
   * Load a plugin by package name
   */
  private async loadPlugin(pluginName: string): Promise<void> {
    try {
      const module = await import(pluginName)
      const factory: PluginFactory = module.default
      if (typeof factory !== 'function') {
        log.warn('plugin-registry', `Plugin ${pluginName} does not export a factory function`)
        return
      }
      const plugin = await factory()
      this.register(plugin)
      log.info('plugin-registry', `Loaded plugin: ${plugin.name}`)
    } catch (err) {
      throw err
    }
  }

  /**
   * Register a plugin
   */
  register(plugin: L10nPlugin): void {
    if (this.plugins.has(plugin.name)) {
      log.warn('plugin-registry', `Plugin ${plugin.name} already registered, skipping`)
      return
    }

    this.plugins.set(plugin.name, plugin)

    // Register extractors
    for (const ext of plugin.extractors ?? []) {
      for (const domainType of ext.domainTypes) {
        if (this.extractors.has(domainType)) {
          log.warn('plugin-registry', `Extractor for ${domainType} already registered, overwriting`)
        }
        this.extractors.set(domainType, ext.extractor)
      }
    }

    // Register compilers
    for (const comp of plugin.compilers ?? []) {
      for (const [type, fn] of Object.entries(comp.compilers)) {
        if (this.compilers.has(type)) {
          log.warn('plugin-registry', `Compiler for ${type} already registered, overwriting`)
        }
        this.compilers.set(type, fn)
      }
    }

    // Register syncers
    for (const sync of plugin.syncers ?? []) {
      if (this.syncers.has(sync.syncTarget)) {
        log.warn('plugin-registry', `Syncer for ${sync.syncTarget} already registered, overwriting`)
      }
      this.syncers.set(sync.syncTarget, sync.syncer)
    }
  }

  /**
   * Get an extractor for a domain type
   */
  getExtractor(domainType: string): ExtractorFunc | undefined {
    return this.extractors.get(domainType)
  }

  /**
   * Get a compiler for a compiler type
   */
  getCompiler(compilerType: string): CompilerFunc | undefined {
    return this.compilers.get(compilerType)
  }

  /**
   * Get a syncer for a sync target
   */
  getSyncer(syncTarget: string): SyncerFunc | undefined {
    return this.syncers.get(syncTarget)
  }

  /**
   * Get the suggested plugin package for a type
   */
  getSuggestedPlugin(type: string): string | undefined {
    return TYPE_TO_PLUGIN[type]
  }

  /**
   * Check if the registry has been initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }
}

export const pluginRegistry = new PluginRegistry()
