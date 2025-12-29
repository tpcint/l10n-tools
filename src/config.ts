import type { ProgramOptions } from './l10n.js'
import type { SupportedPlatforms } from '@lokalise/node-api'
import { invert } from 'es-toolkit/compat'

type L10nConf = {
  '$schema'?: string,
  'domains': { [name: string]: DomainConf },
  /** Validation Config */
  'validation'?: ValidationConf,
  'sync-target'?: SyncTarget,
  'lokalise'?: LokaliseConf,
}

export type SyncTarget = 'lokalise'

/**
 * vue-gettext: Extract from $gettext like function, translate tag, and v-translate attrs
 * vue-i18n: Extract from $t like function, i18n, i18n-t tag, v-t attrs and more
 * typescript (javascript, react, i18next): Extract from .js, .ts, .jsx file with keyword definitions
 * python: Extract from python gettext functions
 * android: Extract from android strings.xml res files
 * ios: Extract from iOS swift files, storyboard, and xib files
 * php-gettext: Extract from php gettext functions
 */
export type DomainType =
  'vue-gettext' |
  'vue-i18n' |
  'react' |
  'javascript' |
  'typescript' |
  'i18next' |
  'python' |
  'android' |
  'ios' |
  'php-gettext'

type DomainConf = {
  'type': DomainType,
  /**
     * Extracting function name and index of key argument list
     * @examples ["translate:1", "translateAll:0"]
     */
  'keywords'?: string[],
  /** Tag name for upload and download */
  'tag': string,
  /** Locales to translate */
  'locales': string[],
  /** Fill translations from fallback locale if not exists */
  'fallback-locale'?: string,
  /** Location to save intermediate files */
  'cache-dir'?: string,
  /** Location of source root (ios only) */
  'src-dir'?: string,
  /**
     * List of location of source root.
     * Used with src-patterns
     */
  'src-dirs'?: string[],
  /**
     * List of glob patterns of location of source root
     * Used with src-dirs
     */
  'src-patterns'?: string[],
  /** List of glob patterns of location of source root to ignore */
  'ignore-patterns'?: string[],
  /** Location of res (android only) */
  'res-dir'?: string,
  /** Lokalise platform to use */
  'lokalise-platform'?: SupportedPlatforms,
  /** List of output formats */
  'outputs': CompilerConf[],
}

export class L10nConfig {
  private readonly rc: L10nConf
  constructor(rc: any) {
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
    return this.rc['sync-target'] ?? 'lokalise'
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

  getKeywords(): string[] {
    return this.dc['keywords'] ?? []
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

  getLokalisePlatform(): SupportedPlatforms {
    const platform = this.dc['lokalise-platform']
    if (platform == null) {
      throw new Error('lokalise-platform is required')
    }
    return platform
  }

  getCompilerConfigs(): CompilerConfig[] {
    return this.dc['outputs'].map(output => new CompilerConfig(output)) ?? []
  }
}

export class SessionConfig {
  constructor(private readonly keysPath: string, private readonly files: string[]) {}

  getFiles(): string[] {
    return this.files
  }

  getKeysPath(): string {
    return this.keysPath
  }
}

/**
 * json (vue-gettext): Single JSON all locales merged
 * json-dir: JSON file per locale (plural not supported)
 * node-i18n: JSON file per locale with node-i18n plural type
 * vue-i18n: JSON file per locale with vue-i18n plural type
 * i18next: JSON file per locale with i18next plural type
 * po-json: JSON PO file per locale
 * mo (python): MO file per locale
 * node-gettext: PO file per locale
 * android: Generate Android strings.xml
 * ios: Merge into iOS strings file
 */
export type CompilerType =
  'json' |
  'vue-gettext' |
  'json-dir' |
  'node-i18n' |
  'vue-i18n' |
  'i18next' |
  'po-json' |
  'mo' |
  'python' |
  'node-gettext' |
  'android' |
  'ios'
type CompilerConf = {
  'type': CompilerType,
  /** Location of JSON files to be saved (json-dir, po-json, mo, node-gettext) */
  'target-dir'?: string,
  /** Path of JSON file to be saved (json) */
  'target-path'?: string,
  /** Location of source root (ios) */
  'src-dir'?: string,
  /** Location of res (android) */
  'res-dir'?: string,
  'default-locale'?: string,
  /** Use locale as root key of json file if true (json-dir) */
  'use-locale-key'?: boolean,
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

  getDefaultLocale(): string | undefined {
    return this.cc['default-locale']
  }

  useLocaleKey(): boolean {
    return this.cc['use-locale-key'] ?? false
  }
}

type ValidationConf = {
  /** If true, do not stop script on error occurs */
  'skip'?: boolean,
  /** Which locale is base text for validation (use key if not specified) */
  'base-locale'?: string,
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

type LokaliseConf = {
  'token': string,
  'projectId': string,
  /** fill key to specified locale */
  'fill-key-to-locale'?: string,
  /** key prefixes which 'fill-key-to-locale' option exclusion */
  'pure-key-prefixes'?: string[],
  /** Locales to use unverified translations */
  'locales-to-use-unverified'?: string[],
  /** Skip applying not-reviewed translations */
  'skip-not-reviewed'?: boolean,
  /** Locale map to pass to syncer */
  'locale-sync-map'?: { [locale: string]: string },
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

  getLocaleSyncMap(inverted: boolean): { [locale: string]: string } | undefined {
    const map = this.lc['locale-sync-map']
    if (map == null) {
      return undefined
    }
    if (inverted) {
      return invert(map)
    } else {
      return map
    }
  }
}
