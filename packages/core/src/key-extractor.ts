import { KeyEntryBuilder } from './key-entry-builder.js'
import { EntryCollection } from './entry-collection.js'
import { type IdKeyAttributes, isSameIdKeyAttributes, type KeyEntry } from './entry.js'

/**
 * Base key extractor class providing core functionality for extracting translation keys.
 * Platform-specific extractors should extend this class or use it directly.
 */
export class KeyExtractor {
  public readonly keys: EntryCollection<KeyEntry>

  constructor() {
    this.keys = new EntryCollection()
  }

  /**
   * Add a translation message/key to the collection.
   * `idKey` 를 지정하면 공용 키 항목으로 기록한다. 같은 키를 다시 추가할 때 키 종류·기본 문구·임시값 여부가 다르거나, 공용 키의 복수형 여부가 다르면 오류가 발생한다.
   */
  addMessage(
    { filename, line }: { filename: string, line?: string | number },
    key: string,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null, idKey?: IdKeyAttributes },
  ) {
    const { isPlural = false, comment = null, context = null, idKey } = options ?? {}
    if (context != null) {
      if (context != context.trim()) {
        throw new Error(`context has leading or trailing whitespace: "${context}"`)
      }
    }
    if (key != key.trim()) {
      throw new Error(`key has leading or trailing whitespace: "${key}"`)
    }
    if (typeof line === 'number') {
      line = line.toString()
    }
    const keyEntry = this.keys.find(context, key)
    if (keyEntry != null && idKey != null && keyEntry.idKey != null && keyEntry.isPlural !== isPlural) {
      throw new Error(`conflicting key "${key}" at ${formatLocation(filename, line)}: `
        + `${isPlural ? 'plural' : 'non-plural'} differs from ${keyEntry.isPlural ? 'plural' : 'non-plural'} `
        + `at ${keyEntry.references.map(ref => formatLocation(ref.file, ref.loc)).join(', ')}`)
    }
    if (keyEntry != null && !isSameIdKeyAttributes(keyEntry.idKey, idKey)) {
      throw new Error(`conflicting key "${key}" at ${formatLocation(filename, line)}: `
        + `${describeIdKey(idKey)} differs from ${describeIdKey(keyEntry.idKey)} `
        + `at ${keyEntry.references.map(ref => formatLocation(ref.file, ref.loc)).join(', ')}`)
    }
    const builder = keyEntry ? KeyEntryBuilder.fromKeyEntry(keyEntry) : new KeyEntryBuilder(context, key, isPlural)
    if (keyEntry == null && idKey != null) {
      builder.setIdKey(idKey)
    }

    builder.addReference(filename, line)
    if (comment) {
      builder.addComment(comment)
    }

    this.keys.set(builder.toKeyEntry())
  }
}

function formatLocation(file: string, loc: string | undefined): string {
  return loc != null ? `${file}:${loc}` : file
}

function describeIdKey(idKey: IdKeyAttributes | undefined): string {
  if (idKey == null) {
    return 'source key'
  }
  const defaultValue = idKey.defaultValue != null ? JSON.stringify(idKey.defaultValue) : 'none'
  return `id key (default value ${defaultValue}${idKey.draft ? ', draft' : ''})`
}

/**
 * Get line number at a given index in source string
 */
export function getLineTo(src: string, index: number, startLine: number = 1): number {
  const matches = src.slice(0, index).match(/\n/g)
  if (!matches) {
    return startLine
  }
  return startLine + matches.length
}
