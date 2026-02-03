import type { BaseEntry } from './entry.js'

export class EntryCollection<Entry extends BaseEntry> {
  private readonly byContext: { [context: string]: Entry | undefined }
  private readonly byKey: { [key: string]: Entry | undefined }

  constructor() {
    this.byContext = {}
    this.byKey = {}
  }

  static loadEntries<Entry extends BaseEntry>(entries: Entry[]): EntryCollection<Entry> {
    const collection = new EntryCollection<Entry>()
    for (const entry of entries) {
      collection.set(entry)
    }
    return collection
  }

  findByEntry(entry: BaseEntry): Entry | null {
    return this.find(entry.context, entry.key)
  }

  find(context: string | null, key: string | null): Entry | null {
    if (context) {
      return this.byContext[context] ?? null
    } else if (key) {
      return this.byKey[key] ?? null
    } else {
      throw new Error('no context nor key')
    }
  }

  set(entry: Entry) {
    if (entry.context) {
      this.byContext[entry.context] = entry
    } else if (entry.key) {
      this.byKey[entry.key] = entry
    } else {
      throw new Error('no context nor key')
    }
  }

  toEntries(): Entry[] {
    return [
      ...Object.values(this.byContext),
      ...Object.values(this.byKey),
    ] as Entry[]
  }
}
