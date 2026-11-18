import { compareKeyReference, type IdKeyAttributes, type KeyEntry, type KeyReference } from './entry.js'
import { sortSet } from './utils.js'

export class KeyEntryBuilder {
  public references: Set<KeyReference>
  public comments: Set<string>
  public idKey: IdKeyAttributes | undefined

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
    if (keyEntry.idKey != null) {
      builder.idKey = { ...keyEntry.idKey }
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

  setIdKey(idKey: IdKeyAttributes): this {
    this.idKey = { ...idKey }
    return this
  }

  toKeyEntry(): KeyEntry {
    const entry: KeyEntry = {
      context: this.context,
      key: this.key,
      isPlural: this.isPlural,
      references: sortSet(this.references, compareKeyReference),
      comments: sortSet(this.comments),
    }
    if (this.idKey != null) {
      entry.idKey = { ...this.idKey }
    }
    return entry
  }
}
