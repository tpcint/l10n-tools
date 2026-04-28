import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EntryCollection } from './entry-collection.js'
import type { KeyEntry } from './entry.js'

function makeKeyEntry(context: string | null, key: string): KeyEntry {
  return {
    context,
    key,
    isPlural: false,
    references: [],
    comments: [],
  }
}

describe('EntryCollection', () => {
  describe('set / find', () => {
    it('stores entries with context under byContext', () => {
      const collection = new EntryCollection<KeyEntry>()
      const entry = makeKeyEntry('ctx', 'k1')
      collection.set(entry)
      assert.equal(collection.find('ctx', null), entry)
    })

    it('stores entries without context under byKey', () => {
      const collection = new EntryCollection<KeyEntry>()
      const entry = makeKeyEntry(null, 'k1')
      collection.set(entry)
      assert.equal(collection.find(null, 'k1'), entry)
    })

    it('returns null when nothing matches', () => {
      const collection = new EntryCollection<KeyEntry>()
      assert.equal(collection.find('missing-ctx', null), null)
      assert.equal(collection.find(null, 'missing-key'), null)
    })

    it('throws when both context and key are falsy on find', () => {
      const collection = new EntryCollection<KeyEntry>()
      assert.throws(() => collection.find(null, null), /no context nor key/)
      assert.throws(() => collection.find('', ''), /no context nor key/)
    })

    it('throws when both context and key are falsy on set', () => {
      const collection = new EntryCollection<KeyEntry>()
      const entry: KeyEntry = { context: null, key: '', isPlural: false, references: [], comments: [] }
      assert.throws(() => collection.set(entry), /no context nor key/)
    })

    it('overwrites a previous entry with the same context', () => {
      const collection = new EntryCollection<KeyEntry>()
      collection.set(makeKeyEntry('ctx', 'first'))
      const second = makeKeyEntry('ctx', 'second')
      collection.set(second)
      assert.equal(collection.find('ctx', null), second)
    })

    it('overwrites a previous entry with the same key when context is null', () => {
      const collection = new EntryCollection<KeyEntry>()
      collection.set(makeKeyEntry(null, 'k1'))
      const second = makeKeyEntry(null, 'k1')
      collection.set(second)
      assert.equal(collection.find(null, 'k1'), second)
    })

    it('prefers context over key when both are provided to find', () => {
      const collection = new EntryCollection<KeyEntry>()
      const ctxEntry = makeKeyEntry('ctx', 'a')
      const keyEntry = makeKeyEntry(null, 'a')
      collection.set(ctxEntry)
      collection.set(keyEntry)
      assert.equal(collection.find('ctx', 'a'), ctxEntry)
    })
  })

  describe('findByEntry', () => {
    it('looks up by the entry context and key', () => {
      const collection = new EntryCollection<KeyEntry>()
      const ctxEntry = makeKeyEntry('ctx', 'a')
      const keyEntry = makeKeyEntry(null, 'b')
      collection.set(ctxEntry)
      collection.set(keyEntry)
      assert.equal(collection.findByEntry({ context: 'ctx', key: 'a' }), ctxEntry)
      assert.equal(collection.findByEntry({ context: null, key: 'b' }), keyEntry)
    })
  })

  describe('loadEntries', () => {
    it('builds a collection by setting each entry', () => {
      const entries = [
        makeKeyEntry('ctx', 'a'),
        makeKeyEntry(null, 'b'),
      ]
      const collection = EntryCollection.loadEntries(entries)
      assert.equal(collection.find('ctx', null), entries[0])
      assert.equal(collection.find(null, 'b'), entries[1])
    })
  })

  describe('toEntries', () => {
    it('returns both context-keyed and key-keyed entries', () => {
      const a = makeKeyEntry('ctx-a', 'k-a')
      const b = makeKeyEntry(null, 'k-b')
      const collection = EntryCollection.loadEntries<KeyEntry>([a, b])
      const result = collection.toEntries()
      assert.equal(result.length, 2)
      assert.ok(result.includes(a))
      assert.ok(result.includes(b))
    })

    it('returns an empty array for an empty collection', () => {
      const collection = new EntryCollection<KeyEntry>()
      assert.deepEqual(collection.toEntries(), [])
    })
  })
})
