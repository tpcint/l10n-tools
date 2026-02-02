import type { DomainConfig } from '../config.js'
import { pluginRegistry } from '../plugin-registry.js'

export type { CompilerFunc } from '../plugin-types.js'

/**
 * Compile translations for all configured output formats.
 *
 * @param domainName - The domain identifier
 * @param domainConfig - Configuration object describing the domain
 * @param transDir - Directory containing translation files
 */
export async function compileAll(domainName: string, domainConfig: DomainConfig, transDir: string) {
  const configs = domainConfig.getCompilerConfigs()
  for (const config of configs) {
    const type = config.getType()

    const compiler = pluginRegistry.getCompiler(type)
    if (!compiler) {
      const suggestedPlugin = pluginRegistry.getSuggestedCompilerPlugin(type)
      const installHint = suggestedPlugin
        ? `\nInstall the required plugin: npm install ${suggestedPlugin}`
        : ''
      throw new Error(`No compiler found for type: ${type}${installHint}`)
    }

    await compiler(domainName, config, transDir)
  }
}
