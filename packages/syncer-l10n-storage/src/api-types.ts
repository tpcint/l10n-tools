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
