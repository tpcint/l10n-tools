import assert from 'node:assert/strict'
import type { EntryCollection } from '../entry-collection.js'
import type { KeyEntry } from '../entry.js'

export function expectKeyEntry(keys: EntryCollection<KeyEntry>, context: string | null, key: string, isPlural: boolean, file?: string, loc?: string) {
  const keyEntry = keys.find(context, key)
  assert.notEqual(keyEntry, null)
  assert.equal(keyEntry!.isPlural, isPlural)
  if (file != null && loc != null) {
    assert(keyEntry!.references.some(reference => reference.file === file && reference.loc === loc))
  }
}
