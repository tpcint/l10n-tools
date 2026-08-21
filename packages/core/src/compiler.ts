import type { DomainConfig } from './config.js'
import type { KeyEntry } from './entry.js'
import type { CompileOptions } from './plugin-types.js'
import { pluginRegistry } from './plugin-registry.js'

export type { CompileOptions, CompilerFunc, OutputKeyReaderFunc } from './plugin-types.js'

/**
 * Identity of a translation entry as compilers merge it.
 *
 * The pair `(context, key)` is the merge unit everywhere: `(msgctxt, msgid)` for gettext,
 * the `.strings` key for iOS, `<string name>` for Android, and the bare key for JSON
 * (which has no contexts). Using one helper keeps output readers comparable with the
 * local key entries they are matched against.
 */
export function outputEntryId(context: string | null | undefined, key: string): string {
  return `${context ?? ''}\u0000${key}`
}

/**
 * Compile translations for all configured output formats.
 *
 * @param domainName - The domain identifier
 * @param domainConfig - Configuration object describing the domain
 * @param transDir - Directory containing translation files
 * @param options - Optional compiler options (e.g., {@link CompileOptions.mergeKeys})
 */
export async function compileAll(
  domainName: string,
  domainConfig: DomainConfig,
  transDir: string,
  options?: CompileOptions,
) {
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

    await compiler(domainName, config, transDir, options)
  }
}

/**
 * Key names that the local source uses but the compiled output does not contain yet.
 *
 * "Does not contain" means the entry is absent from **every** locale of at least one
 * configured output. A key that exists in some locale but is untranslated in others is
 * NOT reported — that is normal translation progress, not a missing key, and treating it
 * as missing would drag every partially-translated key of the project into scope.
 *
 * Returns `null` when the gap cannot be computed for the domain as a whole — some
 * configured output has no {@link OutputKeyReaderFunc}, or does not exist yet — so
 * callers must fall back to their previous behavior rather than act on a partial
 * answer. A missing output in particular must not be read as "every key is missing".
 */
export async function findMissingOutputKeys(
  domainName: string,
  domainConfig: DomainConfig,
  keyEntries: KeyEntry[],
  locales: string[],
): Promise<Set<string> | null> {
  const configs = domainConfig.getCompilerConfigs()
  if (configs.length === 0) {
    return null
  }

  const missing = new Set<string>()
  for (const config of configs) {
    const reader = pluginRegistry.getOutputKeyReader(config.getType())
    if (!reader) {
      return null
    }
    const present = await reader(domainName, config, locales)
    if (present == null) {
      return null
    }
    for (const keyEntry of keyEntries) {
      if (!present.has(outputEntryId(keyEntry.context, keyEntry.key))) {
        missing.add(keyEntry.key)
      }
    }
  }
  return missing
}
