import { z } from 'zod'

// Objects are strict so that a mistyped key in the rc file is reported as an error
// instead of being silently stripped by z.object().

const LokalisePlatformSchema = z.enum(['ios', 'android', 'web', 'other'])
  .meta({ id: 'LokalisePlatform' })
export type LokalisePlatform = z.infer<typeof LokalisePlatformSchema>

export type ProgramOptions = {
  rcfile?: string,
  domains?: string[],
  skipValidation?: boolean,
  validationBaseLocale?: string,
  drySync?: boolean,
  verbose?: boolean,
  quiet?: boolean,
}

const SyncTargetSchema = z.enum(['lokalise', 'l10n-storage'])
  .meta({ id: 'SyncTarget' })
export type SyncTarget = z.infer<typeof SyncTargetSchema>

const DomainTypeSchema = z.enum([
  'vue-gettext',
  'vue-i18n',
  'react',
  'javascript',
  'typescript',
  'i18next',
  'python',
  'android',
  'ios',
]).meta({
  id: 'DomainType',
  description: [
    'vue-gettext: Extract from $gettext like function, translate tag, and v-translate attrs',
    'vue-i18n: Extract from $t like function, i18n, i18n-t tag, v-t attrs and more',
    'typescript (javascript, react, i18next): Extract from .js, .ts, .jsx file with keyword definitions',
    'python: Extract from python gettext functions',
    'android: Extract from android strings.xml res files',
    'ios: Extract from iOS swift files, storyboard, and xib files',
  ].join('\n'),
})
export type DomainType = z.infer<typeof DomainTypeSchema>

const KeywordConfigSchema = z.union([
  z.string(),
  z.strictObject({
    name: z.string().meta({ description: 'Keyword name (e.g., ".localized")' }),
    comment: z.union([z.string(), z.number()]).optional().meta({
      description: [
        'Comment parameter specification',
        '- string: Named parameter name (e.g., "comment" for `localized(comment: "...")`)',
        '- number: Positional index (e.g., 0 for `localized("...")`)',
      ].join('\n'),
    }),
  }),
]).meta({
  id: 'KeywordConfig',
  description: [
    'Keyword configuration for extraction',
    '- string: Simple keyword name (e.g., ".localized", "translate:1")',
    '- object: Detailed configuration with parameter mapping',
  ].join('\n'),
})
export type KeywordConfig = z.infer<typeof KeywordConfigSchema>

const CompilerTypeSchema = z.enum([
  'json',
  'vue-gettext',
  'json-dir',
  'node-i18n',
  'vue-i18n',
  'i18next',
  'po-json',
  'mo',
  'python',
  'node-gettext',
  'android',
  'ios',
]).meta({
  id: 'CompilerType',
  description: [
    'json (vue-gettext): Single JSON all locales merged',
    'json-dir: JSON file per locale (plural not supported)',
    'node-i18n: JSON file per locale with node-i18n plural type',
    'vue-i18n: JSON file per locale with vue-i18n plural type',
    'i18next: JSON file per locale with i18next plural type',
    'po-json: JSON PO file per locale',
    'mo (python): MO file per locale',
    'node-gettext: PO file per locale',
    'android: Generate Android strings.xml',
    'ios: Merge into iOS strings file',
  ].join('\n'),
})
export type CompilerType = z.infer<typeof CompilerTypeSchema>

const CompilerConfSchema = z.strictObject({
  'type': CompilerTypeSchema,
  'target-dir': z.string().optional()
    .meta({ description: 'Location of JSON files to be saved (json-dir, po-json, mo, node-gettext)' }),
  'target-path': z.string().optional()
    .meta({ description: 'Path of JSON file to be saved (json)' }),
  'src-dir': z.string().optional()
    .meta({ description: 'Location of source root (ios)' }),
  'scan-src-dirs': z.array(z.string()).min(1).optional().meta({
    description: '(ios) Scan roots used when re-extracting keys during compile. '
      + 'When set, overrides the output\'s `src-dir` as the scan source. '
      + 'Defaults to `[src-dir]` when omitted. Output location is unaffected.',
  }),
  'res-dir': z.string().optional()
    .meta({ description: 'Location of res (android)' }),
  'modules': z.array(z.string()).optional()
    .meta({ description: 'List of module paths (android only, multi-module support)' }),
  'default-module': z.string().optional()
    .meta({ description: 'Default module that omits prefix in context (android only)' }),
  'default-locale': z.string().optional(),
  'use-locale-key': z.boolean().optional()
    .meta({ description: 'Use locale as root key of json file if true (json-dir)' }),
}).meta({ id: 'CompilerConf' })
type CompilerConf = z.infer<typeof CompilerConfSchema>

const DomainConfSchema = z.strictObject({
  'type': DomainTypeSchema,
  'keywords': z.array(KeywordConfigSchema).optional().meta({
    description: 'Extracting function name and index of key argument list',
    examples: [['translate:1', 'translateAll:0', { name: '.localized', comment: 'comment' }]],
  }),
  'tag': z.string()
    .meta({ description: 'Tag name for upload and download' }),
  'locales': z.array(z.string())
    .meta({ description: 'Locales to translate' }),
  'fallback-locale': z.string().optional()
    .meta({ description: 'Fill translations from fallback locale if not exists' }),
  'cache-dir': z.string().optional()
    .meta({ description: 'Location to save intermediate files' }),
  'src-dir': z.string().optional()
    .meta({ description: 'Location of source root (ios only)' }),
  'src-dirs': z.array(z.string()).optional()
    .meta({ description: 'List of location of source root.\nUsed with src-patterns' }),
  'src-patterns': z.array(z.string()).optional()
    .meta({ description: 'List of glob patterns of location of source root\nUsed with src-dirs' }),
  'ignore-patterns': z.array(z.string()).optional()
    .meta({ description: 'List of glob patterns of location of source root to ignore' }),
  'res-dir': z.string().optional()
    .meta({ description: 'Location of res (android only)' }),
  'modules': z.array(z.string()).optional()
    .meta({ description: 'List of module paths (android only, multi-module support)' }),
  'default-module': z.string().optional()
    .meta({ description: 'Default module that omits prefix in context (android only)' }),
  'lokalise-platform': LokalisePlatformSchema.optional()
    .meta({ description: 'Lokalise platform to use' }),
  'extra-expr-attrs': z.array(z.string()).optional().meta({
    description: 'Extra directive names whose attribute value should be parsed as JavaScript '
      + 'expressions containing translation function calls (vue extractor only).\n\n'
      + 'These are appended to the built-in directive list the extractor already '
      + 'scans (the built-in list differs by extractor type — for example the '
      + 'vue-i18n extractor scans `v-html` by default while the vue-gettext '
      + 'extractor does not). Use this option to register custom directives such '
      + 'as sanitizing HTML wrappers.',
    examples: [['v-dompurify-html'], ['v-dompurify-html', 'v-safe-html']],
  }),
  'outputs': z.array(CompilerConfSchema)
    .meta({ description: 'List of output formats' }),
}).meta({ id: 'DomainConf' })
type DomainConf = z.infer<typeof DomainConfSchema>

const ValidationConfSchema = z.strictObject({
  'skip': z.boolean().optional()
    .meta({ description: 'If true, do not stop script on error occurs' }),
  'base-locale': z.string().optional()
    .meta({ description: 'Which locale is base text for validation (use key if not specified)' }),
}).meta({ id: 'ValidationConf' })
type ValidationConf = z.infer<typeof ValidationConfSchema>

const LocaleSyncMapSchema = z.record(z.string(), z.string())
  .meta({ description: 'Locale map to pass to syncer' })

const L10nStorageConfSchema = z.strictObject({
  'url': z.string().optional()
    .meta({ description: 'Base URL of the tpc-agent service. Can be overridden by TPC_AGENT_URL env var' }),
  'web-url': z.string().optional().meta({
    description: 'Base URL of the TPC Space web app (used to build translation links). '
      + 'Can be overridden by TPC_SPACE_URL env var',
  }),
  'projectId': z.string(),
  'source': z.string().optional()
    .meta({ description: 'Source identifier for tag ownership' }),
  'locale-sync-map': LocaleSyncMapSchema.optional(),
}).meta({ id: 'L10nStorageConf' })
type L10nStorageConf = z.infer<typeof L10nStorageConfSchema>

const LokaliseConfSchema = z.strictObject({
  'token': z.string(),
  'projectId': z.string(),
  'fill-key-to-locale': z.string().optional()
    .meta({ description: 'fill key to specified locale' }),
  'pure-key-prefixes': z.array(z.string()).optional()
    .meta({ description: 'key prefixes which \'fill-key-to-locale\' option exclusion' }),
  'locales-to-use-unverified': z.array(z.string()).optional()
    .meta({ description: 'Locales to use unverified translations' }),
  'skip-not-reviewed': z.boolean().optional()
    .meta({ description: 'Skip applying not-reviewed translations' }),
  'locale-sync-map': LocaleSyncMapSchema.optional(),
}).meta({ id: 'LokaliseConf' })
type LokaliseConf = z.infer<typeof LokaliseConfSchema>

export const L10nConfSchema = z.strictObject({
  '$schema': z.string().optional(),
  'domains': z.record(z.string(), DomainConfSchema),
  'validation': ValidationConfSchema.optional()
    .meta({ description: 'Validation Config' }),
  'sync-target': SyncTargetSchema.optional(),
  'lokalise': LokaliseConfSchema.optional(),
  'l10n-storage': L10nStorageConfSchema.optional(),
})
export type L10nConf = z.infer<typeof L10nConfSchema>

/**
 * Validate a loaded rc file and return it typed.
 * Throws with a readable list of issues when the rc file does not match the schema.
 */
export function parseL10nConf(rc: unknown): L10nConf {
  const result = L10nConfSchema.safeParse(rc)
  if (!result.success) {
    throw new Error(`rc file is not valid\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

export class L10nConfig {
  private readonly rc: L10nConf
  constructor(rc: L10nConf) {
    this.rc = rc
  }

  getDomainNames(): string[] {
    return Object.keys(this.rc.domains)
  }

  getDomainConfig(domain: string): DomainConfig | null {
    const conf = this.rc.domains[domain]
    if (conf == null) {
      return null
    }
    return new DomainConfig(conf)
  }

  getValidationConfig(opts: ProgramOptions): ValidationConfig {
    return new ValidationConfig(this.rc.validation, {
      'base-locale': opts.validationBaseLocale,
      'skip': opts.skipValidation,
    })
  }

  getSyncTarget(): SyncTarget {
    const envTarget = process.env.L10N_SYNC_TARGET
    if (envTarget != null) {
      if (envTarget === 'lokalise' || envTarget === 'l10n-storage') {
        return envTarget
      }
      throw new Error(
        `Invalid L10N_SYNC_TARGET: ${envTarget}. Expected one of: lokalise, l10n-storage`,
      )
    }
    return this.rc['sync-target'] ?? 'lokalise'
  }

  getL10nStorageConfig(): L10nStorageConfig {
    const sc = this.rc['l10n-storage']
    if (sc == null) {
      throw new Error('no l10n-storage in rc')
    }
    return new L10nStorageConfig(sc)
  }

  getLokaliseConfig(): LokaliseConfig {
    const lc = this.rc['lokalise']
    if (lc == null) {
      throw new Error('no lokalise in rc')
    }
    return new LokaliseConfig(lc)
  }

  useUnverified(locale: string): boolean {
    if (this.getSyncTarget() !== 'lokalise') {
      return false
    }
    return this.getLokaliseConfig().useUnverified(locale)
  }
}

export class DomainConfig {
  private readonly dc: DomainConf
  constructor(dc: DomainConf) {
    this.dc = dc
  }

  getType(): DomainType {
    return this.dc['type']
  }

  getTag(): string {
    return this.dc['tag']
  }

  getLocales(): string[] {
    return this.dc['locales']
  }

  getKeywords(): KeywordConfig[] {
    return this.dc['keywords'] ?? []
  }

  /**
   * Get keywords as simple string array (for backward compatibility)
   * Object keywords are converted to their name property
   */
  getKeywordsAsStrings(): string[] {
    return this.getKeywords().map(k => typeof k === 'string' ? k : k.name)
  }

  getCacheDir(): string {
    return this.dc['cache-dir'] ?? '.l10n-tools'
  }

  // for ios only
  getSrcDir(): string {
    const srcDir = this.dc['src-dir']
    if (srcDir == null) {
      throw new Error('src-dir is required for this domain')
    }
    return srcDir
  }

  getSrcDirs(): string[] {
    return this.dc['src-dirs'] ?? []
  }

  getSrcPatterns(): string[] {
    return this.dc['src-patterns'] ?? []
  }

  getIgnorePatterns(): string[] {
    return this.dc['ignore-patterns'] ?? []
  }

  // for android only
  getResDir(): string {
    const resDir = this.dc['res-dir']
    if (resDir == null) {
      throw new Error('res-dir is required for this output')
    }
    return resDir
  }

  // for android multi-module
  getModules(): string[] {
    return this.dc['modules'] ?? []
  }

  getDefaultModule(): string | undefined {
    return this.dc['default-module']
  }

  getLokalisePlatform(): LokalisePlatform {
    const platform = this.dc['lokalise-platform']
    if (platform == null) {
      throw new Error('lokalise-platform is required')
    }
    return platform
  }

  getCompilerConfigs(): CompilerConfig[] {
    return this.dc['outputs'].map(output => new CompilerConfig(output)) ?? []
  }

  /**
   * Extra Vue directive names (exact match) whose attribute values should be
   * scanned for translation function calls by the Vue extractor.
   */
  getExtraExprAttrs(): string[] {
    return this.dc['extra-expr-attrs'] ?? []
  }
}

export class CompilerConfig {
  private readonly cc: CompilerConf
  constructor(cc: CompilerConf) {
    this.cc = cc
  }

  getType(): CompilerType {
    return this.cc.type
  }

  // for ios only
  getSrcDir(): string {
    const srcDir = this.cc['src-dir']
    if (srcDir == null) {
      throw new Error('src-dir is required for this output')
    }
    return srcDir
  }

  /**
   * (ios) Source roots to scan during compile-time key re-extraction.
   * Returns the explicit `scan-src-dirs` list when set, otherwise falls back to `[src-dir]`.
   */
  getScanSrcDirs(): string[] {
    const dirs = this.cc['scan-src-dirs']
    if (dirs != null) {
      if (dirs.length === 0) {
        throw new Error('scan-src-dirs must not be empty when specified')
      }
      return [...dirs]
    }
    return [this.getSrcDir()]
  }

  getTargetDir(): string {
    const targetDir = this.cc['target-dir']
    if (targetDir == null) {
      throw new Error('target-dir is required for this output')
    }
    return targetDir
  }

  getTargetPath(): string {
    const targetPath = this.cc['target-path']
    if (targetPath == null) {
      throw new Error('target-path is required for this output')
    }
    return targetPath
  }

  // for android only
  getResDir(): string {
    const resDir = this.cc['res-dir']
    if (resDir == null) {
      throw new Error('res-dir is required for this output')
    }
    return resDir
  }

  // for android multi-module
  getModules(): string[] {
    return this.cc['modules'] ?? []
  }

  getDefaultModule(): string | undefined {
    return this.cc['default-module']
  }

  getDefaultLocale(): string | undefined {
    return this.cc['default-locale']
  }

  useLocaleKey(): boolean {
    return this.cc['use-locale-key'] ?? false
  }
}

export class ValidationConfig {
  private readonly vc: ValidationConf | undefined
  private readonly opts: ValidationConf
  constructor(vc: ValidationConf | undefined, opts: ValidationConf) {
    this.vc = vc
    this.opts = opts
  }

  getBaseLocale(): string | null {
    return this.opts['base-locale'] ?? this.vc?.['base-locale'] ?? null
  }

  getSkip(): boolean {
    return this.opts['skip'] ?? this.vc?.['skip'] ?? false
  }
}

export class L10nStorageConfig {
  private readonly sc: L10nStorageConf
  constructor(sc: L10nStorageConf) {
    this.sc = sc
  }

  getUrl(): string {
    const url = process.env.TPC_AGENT_URL ?? this.sc.url
    if (!url) {
      throw new Error('l10n-storage url is required: set TPC_AGENT_URL env var or url in config')
    }
    return url
  }

  getWebUrl(): string {
    const url = process.env.TPC_SPACE_URL || this.sc['web-url'] || 'https://space.tpcground.com'
    return url.replace(/\/+$/, '')
  }

  getProjectId(): string {
    return this.sc.projectId
  }

  /**
   * Build a link to the TPC Space translation view scoped to a tag/source pair,
   * e.g. https://space.tpcground.com/l10n/translations?project=<id>&tagSource=<tag>/<source>
   */
  getTranslationLink(tag: string, source: string): string {
    const project = encodeURIComponent(this.getProjectId())
    const tagSource = `${encodeURIComponent(tag)}/${encodeURIComponent(source)}`
    return `${this.getWebUrl()}/l10n/translations?project=${project}&tagSource=${tagSource}`
  }

  getSource(): string {
    return this.sc.source ?? 'main'
  }

  getLocaleSyncMap(): { [locale: string]: string } | undefined {
    return this.sc['locale-sync-map']
  }
}

export class LokaliseConfig {
  private readonly lc: LokaliseConf
  constructor(lc: LokaliseConf) {
    this.lc = lc
  }

  getToken(): string {
    return this.lc['token']
  }

  getProjectId(): string {
    return this.lc['projectId']
  }

  useUnverified(locale: string): boolean {
    return this.lc['locales-to-use-unverified']?.includes(locale) ?? false
  }

  skipNotReviewed(): boolean {
    return this.lc['skip-not-reviewed'] ?? false
  }

  fillKeyToLocale(): string | null {
    return this.lc['fill-key-to-locale'] ?? null
  }

  getPureKeyPrefixes(): string[] {
    return this.lc['pure-key-prefixes'] ?? []
  }

  getLocaleSyncMap(): { [locale: string]: string } | undefined {
    return this.lc['locale-sync-map']
  }
}
