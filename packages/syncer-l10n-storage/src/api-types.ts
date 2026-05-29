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

export interface L10nKeyToServe {
  id: string,
  keyName: string,
  isPlural: boolean,
  tags: L10nKeyTag[],
  metadata: L10nKeyMetadata[],
  translations: L10nServedTranslation[],
}

export interface CreateSuggestionInput {
  locale: string,
  translation: Record<string, string>,
  suggestedBy?: string,
}

export interface CreateL10nKeyInput {
  keyName: string,
  isPlural?: boolean,
  tags?: L10nKeyTag[],
  metadata?: L10nKeyMetadata[],
  suggestions?: CreateSuggestionInput[],
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
