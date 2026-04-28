export interface L10nKeyTag {
  tag: string,
  source: string,
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
  removeTags?: L10nKeyTag[],
  setMetadata?: L10nKeyMetadata[],
  suggestions?: CreateSuggestionInput[],
}

export interface ListKeysToServeResponse {
  keys: L10nKeyToServe[],
  nextCursor: string | null,
}
