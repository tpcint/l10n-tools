import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { L10nPlugin } from './plugin-types.js'
import { PluginRegistry } from './plugin-registry.js'

function makePlugin(overrides: Partial<L10nPlugin> = {}): L10nPlugin {
  return {
    name: overrides.name ?? 'test-plugin',
    extractors: overrides.extractors,
    compilers: overrides.compilers,
    syncers: overrides.syncers,
  }
}

const noopExtractor = async () => {}
const noopCompiler = async () => {}
const noopSyncer = async () => {}

describe('PluginRegistry', () => {
  describe('register', () => {
    it('registers extractors keyed by domain type', () => {
      const registry = new PluginRegistry()
      registry.register(makePlugin({
        extractors: [{ domainTypes: ['vue-i18n', 'vue-gettext'], extractor: noopExtractor }],
      }))
      assert.equal(registry.getExtractor('vue-i18n'), noopExtractor)
      assert.equal(registry.getExtractor('vue-gettext'), noopExtractor)
      assert.equal(registry.getExtractor('unknown'), undefined)
    })

    it('registers compilers keyed by their type', () => {
      const registry = new PluginRegistry()
      registry.register(makePlugin({
        compilers: [{ compilerTypes: ['json'], compilers: { 'json': noopCompiler, 'json-dir': noopCompiler } }],
      }))
      assert.equal(registry.getCompiler('json'), noopCompiler)
      assert.equal(registry.getCompiler('json-dir'), noopCompiler)
      assert.equal(registry.getCompiler('unknown'), undefined)
    })

    it('registers syncers keyed by sync target', () => {
      const registry = new PluginRegistry()
      registry.register(makePlugin({
        syncers: [{ syncTarget: 'lokalise', syncer: noopSyncer }],
      }))
      assert.equal(registry.getSyncer('lokalise'), noopSyncer)
      assert.equal(registry.getSyncer('unknown'), undefined)
    })

    it('skips a plugin already registered with the same name', () => {
      const registry = new PluginRegistry()
      const first = async () => {}
      const second = async () => {}
      registry.register(makePlugin({
        name: 'dup',
        extractors: [{ domainTypes: ['t'], extractor: first }],
      }))
      registry.register(makePlugin({
        name: 'dup',
        extractors: [{ domainTypes: ['t'], extractor: second }],
      }))
      assert.equal(registry.getExtractor('t'), first)
    })

    it('overwrites a previously registered handler when names differ', () => {
      const registry = new PluginRegistry()
      const first = async () => {}
      const second = async () => {}
      registry.register(makePlugin({
        name: 'a',
        extractors: [{ domainTypes: ['t'], extractor: first }],
      }))
      registry.register(makePlugin({
        name: 'b',
        extractors: [{ domainTypes: ['t'], extractor: second }],
      }))
      assert.equal(registry.getExtractor('t'), second)
    })

    it('exposes registered plugins via getPlugins', () => {
      const registry = new PluginRegistry()
      const plugin = makePlugin({ name: 'a' })
      registry.register(plugin)
      assert.equal(registry.getPlugins().get('a'), plugin)
      assert.equal(registry.getPlugins().size, 1)
    })
  })

  describe('suggestion lookups', () => {
    const registry = new PluginRegistry()

    it('suggests extractor plugin packages for known domain types', () => {
      assert.equal(registry.getSuggestedExtractorPlugin('android'), 'l10n-tools-plugin-android')
      assert.equal(registry.getSuggestedExtractorPlugin('vue-i18n'), 'l10n-tools-extractor-vue')
      assert.equal(registry.getSuggestedExtractorPlugin('javascript'), 'l10n-tools-extractor-javascript')
      assert.equal(registry.getSuggestedExtractorPlugin('unknown'), undefined)
    })

    it('suggests compiler plugin packages for known compiler types', () => {
      assert.equal(registry.getSuggestedCompilerPlugin('json'), 'l10n-tools-compiler-json')
      assert.equal(registry.getSuggestedCompilerPlugin('mo'), 'l10n-tools-compiler-gettext')
      assert.equal(registry.getSuggestedCompilerPlugin('ios'), 'l10n-tools-plugin-ios')
      assert.equal(registry.getSuggestedCompilerPlugin('unknown'), undefined)
    })

    it('suggests syncer plugin packages for known sync targets', () => {
      assert.equal(registry.getSuggestedSyncerPlugin('lokalise'), 'l10n-tools-syncer-lokalise')
      assert.equal(registry.getSuggestedSyncerPlugin('l10n-storage'), 'l10n-tools-syncer-l10n-storage')
      assert.equal(registry.getSuggestedSyncerPlugin('unknown'), undefined)
    })
  })

  describe('isInitialized', () => {
    it('starts as false', () => {
      const registry = new PluginRegistry()
      assert.equal(registry.isInitialized(), false)
    })
  })
})
