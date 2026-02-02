import { KeyEntryBuilder } from './key-entry-builder.js'
import { EntryCollection } from './entry-collection.js'
import type { KeyEntry } from './entry.js'

/**
 * Base key extractor class providing core functionality for extracting translation keys.
 * Platform-specific extractors should extend this class or use it directly.
 */
export class BaseKeyExtractor {
  public readonly keys: EntryCollection<KeyEntry>

  constructor() {
    this.keys = new EntryCollection()
  }

  /**
   * Add a translation message/key to the collection
   */
  addMessage(
    { filename, line }: { filename: string, line?: string | number },
    key: string,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null },
  ) {
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
}

/**
 * Get line number at a given index in source string
 */
export function getLineTo(src: string, index: number, startLine: number = 1): number {
  const matches = src.substr(0, index).match(/\n/g)
  if (!matches) {
    return startLine
  }
  return startLine + matches.length
}
