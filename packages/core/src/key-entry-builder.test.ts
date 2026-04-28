import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyEntry } from './entry.js'
import { KeyEntryBuilder } from './key-entry-builder.js'

describe('KeyEntryBuilder', () => {
  describe('toKeyEntry', () => {
    it('builds an entry with sorted references and comments', () => {
      const builder = new KeyEntryBuilder('ctx', 'greeting', true)
      builder.addReference('b.ts', '2')
      builder.addReference('a.ts', '5')
      builder.addReference('a.ts', '1')
      builder.addComment('beta')
      builder.addComment('alpha')

      const entry = builder.toKeyEntry()

      assert.equal(entry.context, 'ctx')
      assert.equal(entry.key, 'greeting')
      assert.equal(entry.isPlural, true)
      assert.deepEqual(entry.references, [
        { file: 'a.ts', loc: '1' },
        { file: 'a.ts', loc: '5' },
        { file: 'b.ts', loc: '2' },
      ])
      assert.deepEqual(entry.comments, ['alpha', 'beta'])
    })

    it('returns empty references and comments when nothing is added', () => {
      const builder = new KeyEntryBuilder(null, 'k', false)
      const entry = builder.toKeyEntry()
      assert.deepEqual(entry.references, [])
      assert.deepEqual(entry.comments, [])
    })

    it('deduplicates identical comments', () => {
      const builder = new KeyEntryBuilder(null, 'k', false)
      builder.addComment('same')
      builder.addComment('same')
      assert.deepEqual(builder.toKeyEntry().comments, ['same'])
    })
  })

  describe('addReference / addComment', () => {
    it('returns the builder for chaining', () => {
      const builder = new KeyEntryBuilder(null, 'k', false)
      assert.equal(builder.addReference('a.ts', '1'), builder)
      assert.equal(builder.addComment('c'), builder)
    })

    it('accepts a reference without a line', () => {
      const builder = new KeyEntryBuilder(null, 'k', false)
      builder.addReference('a.ts')
      const entry = builder.toKeyEntry()
      assert.equal(entry.references.length, 1)
      assert.equal(entry.references[0].file, 'a.ts')
      assert.equal(entry.references[0].loc, undefined)
    })
  })

  describe('fromKeyEntry', () => {
    it('round-trips an entry', () => {
      const original: KeyEntry = {
        context: 'ctx',
        key: 'greeting',
        isPlural: true,
        references: [
          { file: 'a.ts', loc: '1' },
          { file: 'b.ts', loc: '2' },
        ],
        comments: ['alpha', 'beta'],
      }
      const rebuilt = KeyEntryBuilder.fromKeyEntry(original).toKeyEntry()
      assert.deepEqual(rebuilt, original)
    })

    it('coerces empty-string context to null', () => {
      const original: KeyEntry = {
        context: '',
        key: 'k',
        isPlural: false,
        references: [],
        comments: [],
      }
      const builder = KeyEntryBuilder.fromKeyEntry(original)
      assert.equal(builder.context, null)
    })
  })
})
