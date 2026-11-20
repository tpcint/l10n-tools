export interface L10nKeyTag {
  tag: string,
  source: string,
}

/**
 * removeTags 입력. source를 생략하면 그 `(key, tag)`의 모든 source row를 unclaim한다.
 * source를 명시하면 해당 `(tag, source)` 한 줄만 제거한다.
 * 전체 sync(특정 PR 스코프가 아닌 default sync)의 cleanup은 source 생략 형태를 쓰고, 특정 source
 * sync(PR scope)의 self-cleanup은 자기 `(tag, source)`만 정리하기 위해 source를 명시한다.
 */
export interface RemoveTagInput {
  tag: string,
  source?: string,
}

export interface L10nKeyMetadata {
  tag: string | null,
  metaKey: string,
  metaValue: string,
}

export interface L10nServedTranslation {
  locale: string,
  translation: Record<string, string>,
}

/** 키 종류. `source` 는 원문 키, `id` 는 공용 키 */
export type L10nKeyKind = 'source' | 'id'

export interface L10nKeyToServe {
  id: string,
  keyName: string,
  /** 공용 키 계약 이전 서버는 반환하지 않는다. 없으면 `source` 다 */
  keyKind?: L10nKeyKind,
  isPlural: boolean,
  isDraft?: boolean,
  tags: L10nKeyTag[],
  metadata: L10nKeyMetadata[],
  translations: L10nServedTranslation[],
}

export interface SuggestionOriginInput {
  type: 'local',
}

export interface CreateSuggestionInput {
  locale: string,
  translation: Record<string, string>,
  suggestedBy?: string,
  origin?: SuggestionOriginInput,
}

export interface CreateL10nKeyInput {
  keyName: string,
  /** 생략하면 서버가 `source` 로 처리한다 */
  keyKind?: L10nKeyKind,
  isPlural?: boolean,
  tags?: L10nKeyTag[],
  metadata?: L10nKeyMetadata[],
  suggestions?: CreateSuggestionInput[],
  /** 공용 키만. 키를 새로 만들 때 원문 locale 번역으로 등록된다 */
  defaultText?: Record<string, string>,
  /** 공용 키만. 기본 문구가 임시값인지 */
  isDraft?: boolean,
}

export interface UpdateL10nKeyInput {
  keyId: string,
  addTags?: L10nKeyTag[],
  removeTags?: RemoveTagInput[],
  setMetadata?: L10nKeyMetadata[],
  suggestions?: CreateSuggestionInput[],
}

export interface ListKeysToServeResponse {
  keys: L10nKeyToServe[],
  nextCursor: string | null,
}

export type L10nTagKeyMode = 'source' | 'id'

export interface L10nTagSyncSettings {
  tag: string,
  keyMode: L10nTagKeyMode,
  minSyncerVersion: string | null,
}

export interface FindKeysBySourceTextsInput {
  texts: Record<string, string>[],
  isPlural?: boolean,
  keyKind?: L10nKeyKind,
  includeDraft?: boolean,
}

export interface L10nSourceTextMatchedKey {
  id: string,
  keyName: string,
  keyKind: L10nKeyKind,
  isPlural: boolean,
  isDraft: boolean,
  sourceStatus: 'confirmed' | 'suggestion' | 'keyName',
  tags: L10nKeyTag[],
}

export interface L10nSourceTextMatchResult {
  text: Record<string, string>,
  keys: L10nSourceTextMatchedKey[],
}

export interface FindKeysBySourceTextsResponse {
  results: L10nSourceTextMatchResult[],
}

export interface L10nSyncerUpgradeRequiredPayload {
  tag: string,
  keyMode: L10nTagKeyMode,
  minSyncerVersion: string,
  requestVersion: string | null,
}

export interface L10nKeyMigrationItemInput {
  idKeyName: string,
  sourceKeyName: string,
  /** 원문 키의 태그 context 메타데이터 중 이 리소스에 해당하는 항목. 최대 10개 */
  contexts: string[],
}

export interface L10nKeyMigrationInput {
  dryRun: boolean,
  tag: string,
  source: string,
  items: L10nKeyMigrationItemInput[],
  tagSettings: { keyMode: 'id', minSyncerVersion: string },
}

export interface L10nKeyMigrationSummary {
  items: number,
  idKeysCreated: number,
  idKeysReused: number,
  translationsCopied: number,
  suggestionsCopied: number,
  conflicts: number,
  tagsMoved: number,
}

export interface L10nKeyMigrationConflict {
  locale: string,
  status: 'confirmed' | 'suggestion',
  /** 공용 키에 이미 있던 값 (유지) */
  existing: Record<string, string>,
  /** 원문 키의 같은 종류 값 (복사하지 않음) */
  incoming: Record<string, string> | null,
}

export interface L10nKeyMigrationItemResult {
  idKeyName: string,
  idKeyId: string | null,
  idKeyCreated: boolean,
  sourceKeyId: string,
  sourceKeyName: string,
  translationsCopied: string[],
  suggestionsCopied: string[],
  conflicts: L10nKeyMigrationConflict[],
  tagMoved: boolean,
  contextsMoved: string[],
  warnings: string[],
}

export type L10nKeyMigrationErrorReason =
  | 'source-key-not-found'
  | 'plural-mismatch'
  | 'duplicate-id-key-name'
  | 'id-key-tag-conflict'

export interface L10nKeyMigrationError {
  /** 요청 `items` 배열의 위치 */
  index: number,
  idKeyName: string,
  sourceKeyName: string,
  reason: L10nKeyMigrationErrorReason,
  message: string,
}

export interface L10nKeyMigrationTagSettingsChange {
  before: L10nTagSyncSettings,
  after: L10nTagSyncSettings,
}

export interface L10nKeyMigrationKeyTagRef {
  keyId: string,
  source: string,
}

export interface L10nKeyMigrationRollbackPlan {
  migrationId: string,
  tag: string,
  untag: L10nKeyMigrationKeyTagRef[],
  retag: L10nKeyMigrationKeyTagRef[],
  restoreMetadata: { keyId: string, metaKey: string, metaValue: string | null }[],
  tagSettings: L10nTagSyncSettings,
}

export interface L10nKeyMigrationResponse {
  migrationId: string | null,
  dryRun: boolean,
  summary: L10nKeyMigrationSummary,
  items: L10nKeyMigrationItemResult[],
  /** dry-run 에서만 채워진다. 실제 적용에서 오류가 있으면 400 으로 거부된다 */
  errors: L10nKeyMigrationError[],
  tagSettings: L10nKeyMigrationTagSettingsChange,
  rollbackPlan: L10nKeyMigrationRollbackPlan | null,
}

export interface L10nKeyMigrationInvalidPayload {
  errors: L10nKeyMigrationError[],
}

export interface L10nKeyMigrationRollbackInput {
  migrationId: string,
  dryRun: boolean,
}

export interface L10nKeyMigrationRollbackResponse {
  dryRun: boolean,
  migrationId: string,
  untagged: number,
  retagged: number,
  metadataRestored: number,
  tagSettings: L10nKeyMigrationTagSettingsChange,
  /** 이미 되돌려져 있거나 키가 없어 건너뛴 항목 */
  warnings: string[],
}
