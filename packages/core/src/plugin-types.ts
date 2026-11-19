import type { CompilerConfig, DomainConfig, L10nConfig } from './config.js'
import type { KeyEntry, TransEntry, TransMessages } from './entry.js'

/**
 * 태그의 키 방식. `source` 는 원문을 키로 쓰고, `id` 는 공용 키를 쓴다.
 * `id` 태그에서도 원문 키 항목이 함께 쓰일 수 있다.
 */
export type KeyMode = 'source' | 'id'

/**
 * Options that may be passed to an extractor invocation.
 */
export interface ExtractOptions {
  /** 생략하면 `source` 로 동작한다 */
  keyMode?: KeyMode,
}

/**
 * Extractor function signature
 * Extracts translation keys from source files
 */
export type ExtractorFunc = (
  domainName: string,
  domainConfig: DomainConfig,
  keysPath: string,
  options?: ExtractOptions,
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
 * Options that may be passed to a compiler invocation.
 */
export interface CompileOptions {
  /**
   * When set, the compiler must update only the entries whose keyName is in the set
   * and preserve any other entries that already exist in the output. An empty set
   * means "no entries to update" — the compiler must leave existing outputs untouched.
   * If not set, the compiler performs a full overwrite of the output (default behavior).
   */
  mergeKeys?: Set<string>,
  /** 생략하면 `source` 로 동작한다 */
  keyMode?: KeyMode,
}

/**
 * Compiler function signature
 * Compiles translations to platform-specific formats
 */
export type CompilerFunc = (
  domainName: string,
  config: CompilerConfig,
  transDir: string,
  options?: CompileOptions,
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
  /** 로컬 키를 추출한 키 방식. 생략하면 `source` 다 */
  keyMode?: KeyMode,
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
 * Optional capability: 동기화 대상에 설정된 태그의 키 방식을 조회한다.
 * 추출·컴파일·sync 가 같은 키 방식을 쓰도록 CLI 가 명령 시작 시 호출한다.
 */
export type SyncerKeyModeFunc = (
  config: L10nConfig,
  domainConfig: DomainConfig,
  tag: string,
) => Promise<KeyMode>

/**
 * PR 체크에서 확인을 권하는 공용 키 경고. 체크를 실패시키지 않는다.
 * - `renamed-key`: 새 공용 키의 기본 문구가 head 에서 사라진 공용 키의 원문과 같다 (키 지정 누락 의심)
 * - `reusable-key`: 새 공용 키의 기본 문구와 원문이 같은 기존 공용 키가 있다 (재사용 검토)
 */
export interface SyncerKeyWarning {
  kind: 'renamed-key' | 'reusable-key',
  /** 경고 대상인 새 공용 키 */
  keyName: string,
  /** 원문이 같은 기존 공용 키 */
  relatedKeyNames: string[],
  /** 사람이 읽는 안내 */
  message: string,
}

/**
 * Optional capability: `source` 범위(PR-N)의 새 공용 키를 동기화 대상의 키와 비교해 경고를 만든다.
 */
export type SyncerKeyWarningsFunc = (
  config: L10nConfig,
  domainConfig: DomainConfig,
  tag: string,
  source: string,
  keyEntries: KeyEntry[],
) => Promise<SyncerKeyWarning[]>

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
  /** Optional: 태그의 키 방식 조회. 없으면 `source` 로 동작한다 */
  keyMode?: SyncerKeyModeFunc,
  /** Optional: PR 체크용 공용 키 경고 */
  keyWarnings?: SyncerKeyWarningsFunc,
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
