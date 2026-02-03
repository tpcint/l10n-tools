import { compareKeyReference, type KeyEntry, type KeyReference } from './entry.js'
import { sortSet } from './utils.js'

export class KeyEntryBuilder {
  public references: Set<KeyReference>
  public comments: Set<string>

  constructor(public context: string | null, public key: string, public isPlural: boolean) {
    this.references = new Set()
    this.comments = new Set()
  }

  static fromKeyEntry(keyEntry: KeyEntry): KeyEntryBuilder {
    const builder = new KeyEntryBuilder(keyEntry.context || null, keyEntry.key, keyEntry.isPlural)
    for (const reference of keyEntry.references) {
      builder.references.add(reference)
    }
    for (const comment of keyEntry.comments) {
      builder.comments.add(comment)
    }
    return builder
  }

  addReference(filename: string, line?: string): this {
    this.references.add({ file: filename, loc: line })
    return this
  }

  addComment(comment: string): this {
    this.comments.add(comment)
    return this
  }

  toKeyEntry(): KeyEntry {
    return {
      context: this.context,
      key: this.key,
      isPlural: this.isPlural,
      references: sortSet(this.references, compareKeyReference),
      comments: sortSet(this.comments),
    }
  }
}
