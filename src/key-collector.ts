import { KeyEntryBuilder } from './key-entry-builder.js'
import { EntryCollection } from './entry-collection.js'
import type { KeyEntry } from './entry.js'

export type TemplateMarker = {
  start: string,
  end: string,
  type?: 'js',
}

type KeyCollectorOptions = {
  keywords: string[] | Set<string>,
  tagNames: string[],
  attrNames: string[],
  valueAttrNames: string[],
  objectAttrs: { [name: string]: string[] },
  filterNames: string[],
  markers: TemplateMarker[],
  exprAttrs: RegExp[],
}

type KeywordDef = {
  objectName: string | null,
  position: number,
  propName: string,
}

type KeywordArgumentPositions = {
  key: number,
  pluralCount: number | null,
}

export class KeyCollector {
  public readonly keys: EntryCollection<KeyEntry>
  public readonly keywordDefs: KeywordDef[]
  public readonly options: KeyCollectorOptions
  public readonly keywordMap: { [keyword: string]: KeywordArgumentPositions }

  constructor(options: Partial<KeyCollectorOptions>) {
    this.keys = new EntryCollection()
    this.options = Object.assign<KeyCollectorOptions, Partial<KeyCollectorOptions>>({
      keywords: [],
      tagNames: [],
      attrNames: [],
      valueAttrNames: [],
      objectAttrs: {},
      filterNames: [],
      markers: [],
      exprAttrs: [],
    }, options)

    this.keywordDefs = [...this.options.keywords].map(keyword => parseKeyword(keyword))
    this.keywordMap = buildKeywordMap(this.options.keywords)
  }

  addMessage({ filename, line }: { filename: string, line?: string | number }, key: string,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    const { isPlural = false, comment = null, context = null } = options ?? {}
    if (context != null) {
      if (context != context.trim()) {
        throw new Error(`context has leading or trailing whitespace: "${context}"`)
      }
    }
    if (key != key.trim()) {
      throw new Error(`key has leading or trailing whitespace: "${key}"`)
    }
    const keyEntry = this.keys.find(context, key)
    const builder = keyEntry ? KeyEntryBuilder.fromKeyEntry(keyEntry) : new KeyEntryBuilder(context, key, isPlural)

    if (typeof line === 'number') {
      line = line.toString()
    }
    builder.addReference(filename, line)
    if (comment) {
      builder.addComment(comment)
    }

    this.keys.set(builder.toKeyEntry())
  }

  getEntries(): KeyEntry[] {
    return this.keys.toEntries()
  }
}

function parseKeyword(keyword: string): KeywordDef {
  const [name, _pos] = keyword.split(':')
  const position = _pos ? Number.parseInt(_pos) : 0
  const [name1, name2] = name.split('.')
  if (name2) {
    return {
      objectName: name1,
      propName: name2,
      position: position,
    }
  } else {
    return {
      objectName: null,
      propName: name1,
      position: position,
    }
  }
}

function buildKeywordMap(keywords: string[] | Set<string>): { [keyword: string]: KeywordArgumentPositions } {
  const keywordMap: { [keyword: string]: KeywordArgumentPositions } = {}
  for (const keyword of keywords) {
    const [name, keyPos, pluralCountPos] = keyword.split(':')
    const key = keyPos ? Number.parseInt(keyPos) : 0
    let pluralCount: number | null
    if (keyPos != null) {
      pluralCount = pluralCountPos ? Number.parseInt(pluralCountPos) : null
    } else {
      pluralCount = key + 1
    }
    keywordMap[name] = { key, pluralCount }
  }
  return keywordMap
}

export function getLineTo(src: string, index: number, startLine: number = 1): number {
  const matches = src.substr(0, index).match(/\n/g)
  if (!matches) {
    return startLine
  }
  return startLine + matches.length
}
