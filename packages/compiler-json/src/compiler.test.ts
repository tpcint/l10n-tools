import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TransEntry } from 'l10n-tools-core'
import { buildJsonTrans } from './compiler.js'

function makeTransEntry(overrides: Partial<TransEntry> = {}): TransEntry {
  return {
    context: overrides.context ?? null,
    key: overrides.key ?? 'k',
    messages: overrides.messages ?? { other: 'translated' },
    flag: overrides.flag ?? null,
  }
}

describe('buildJsonTrans', () => {
  describe('single message', () => {
    it('returns the "other" string when only one message form is present', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'hello', messages: { other: 'Hello' } }),
      ])
      assert.deepEqual(result, { hello: 'Hello' })
    })

    it('skips entries with empty key', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: '', messages: { other: 'X' } }),
      ])
      assert.deepEqual(result, {})
    })

    it('skips entries without an "other" message', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'k', messages: {} }),
      ])
      assert.deepEqual(result, {})
    })
  })

  describe('plural with vue-i18n', () => {
    it('joins plural forms with " | " in locale plural-key order', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'item', messages: { one: '1 item', other: '{n} items' } }),
      ], 'vue-i18n')
      assert.deepEqual(result, { item: '1 item | {n} items' })
    })

    it('falls back to "other" for missing plural keys', () => {
      const result = buildJsonTrans('ru', [
        makeTransEntry({ key: 'apple', messages: { one: '1', other: 'many' } }),
      ], 'vue-i18n')
      assert.deepEqual(result, { apple: '1 | many | many | many' })
    })
  })

  describe('plural with node-i18n', () => {
    it('emits the messages object as-is', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'item', messages: { one: '1', other: 'many' } }),
      ], 'node-i18n')
      assert.deepEqual(result, { item: { one: '1', other: 'many' } })
    })
  })

  describe('plural with i18next', () => {
    it('emits one key per plural form, suffixed with the form name', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'item', messages: { one: '1', other: 'many' } }),
      ], 'i18next')
      assert.deepEqual(result, { item_one: '1', item_other: 'many' })
    })
  })

  describe('plural without pluralType', () => {
    it('emits no key for plural entries when pluralType is not provided', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'item', messages: { one: '1', other: 'many' } }),
      ])
      assert.deepEqual(result, {})
    })
  })

  describe('context', () => {
    it('throws when an entry has a context', () => {
      assert.throws(
        () => buildJsonTrans('en', [makeTransEntry({ context: 'menu' })]),
        /trans entry with context is not supported/,
      )
    })
  })

  describe('multiple entries', () => {
    it('mixes single and plural entries in one output', () => {
      const result = buildJsonTrans('en', [
        makeTransEntry({ key: 'hi', messages: { other: 'Hi' } }),
        makeTransEntry({ key: 'item', messages: { one: '1', other: 'many' } }),
      ], 'i18next')
      assert.deepEqual(result, {
        hi: 'Hi',
        item_one: '1',
        item_other: 'many',
      })
    })
  })
})
