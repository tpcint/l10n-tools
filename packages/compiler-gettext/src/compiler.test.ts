import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TransEntry } from 'l10n-tools-core'
import { createPo, createPoEntry } from './compiler.js'

function makeTransEntry(overrides: Partial<TransEntry> = {}): TransEntry {
  return {
    context: overrides.context ?? null,
    key: overrides.key ?? 'k',
    messages: overrides.messages ?? { other: 'translated' },
    flag: overrides.flag ?? null,
  }
}

describe('createPoEntry', () => {
  it('returns a single msgstr when only "other" is present', () => {
    const entry = createPoEntry('en', makeTransEntry({ key: 'hello', messages: { other: 'Hello' } }))
    assert.equal(entry.msgid, 'hello')
    assert.equal(entry.msgctxt, undefined)
    assert.equal(entry.msgid_plural, undefined)
    assert.deepEqual(entry.msgstr, ['Hello'])
  })

  it('uses an empty msgstr when "other" is missing', () => {
    const entry = createPoEntry('en', makeTransEntry({ key: 'hello', messages: {} }))
    assert.deepEqual(entry.msgstr, [''])
  })

  it('sets msgctxt when context is provided', () => {
    const entry = createPoEntry('en', makeTransEntry({ context: 'menu', key: 'File' }))
    assert.equal(entry.msgctxt, 'menu')
  })

  it('emits plural form with msgid_plural and one msgstr per plural key of the locale', () => {
    const entry = createPoEntry('en', makeTransEntry({
      key: '{n} item',
      messages: { one: '1 item', other: '{n} items' },
    }))
    assert.equal(entry.msgid, '{n} item')
    assert.equal(entry.msgid_plural, '{n} item')
    assert.deepEqual(entry.msgstr, ['1 item', '{n} items'])
  })

  it('falls back to "other" when a plural key is missing for the locale', () => {
    const entry = createPoEntry('ru', makeTransEntry({
      key: 'apple',
      messages: { one: '1 apple', other: 'many apples' },
    }))
    // Russian uses one+few+many+other; missing few/many fall back to "other".
    assert.deepEqual(entry.msgstr, ['1 apple', 'many apples', 'many apples', 'many apples'])
  })

  it('returns a single msgstr when messages contains exactly one entry, even if not "other"', () => {
    // Branch behavior: keys.length == 1 short-circuits to single-form regardless of which key is present.
    const entry = createPoEntry('en', makeTransEntry({
      key: 'apple',
      messages: { one: '1 apple' },
    }))
    assert.equal(entry.msgid_plural, undefined)
    assert.deepEqual(entry.msgstr, [''])
  })
})

describe('createPo', () => {
  it('sets headers using domainName and locale', () => {
    const po = createPo('frontend', 'ko-KR', [])
    assert.equal(po.charset, 'utf-8')
    assert.equal(po.headers['Project-Id-Version'], 'frontend')
    assert.equal(po.headers['Language'], 'ko-KR')
    assert.equal(po.headers['Content-Type'], 'text/plain; charset=UTF-8')
    assert.equal(po.headers['X-Generator'], 'l10n-tools')
    assert.deepEqual(po.translations, {})
  })

  it('groups entries by msgctxt (empty string for null context)', () => {
    const po = createPo('d', 'en', [
      makeTransEntry({ context: null, key: 'a', messages: { other: 'A' } }),
      makeTransEntry({ context: 'menu', key: 'b', messages: { other: 'B' } }),
    ])
    assert.ok(po.translations[''])
    assert.ok(po.translations['menu'])
    assert.equal(po.translations[''].a.msgstr[0], 'A')
    assert.equal(po.translations['menu'].b.msgstr[0], 'B')
    assert.equal(po.translations['menu'].b.msgctxt, 'menu')
  })

  it('keeps multiple entries within the same context', () => {
    const po = createPo('d', 'en', [
      makeTransEntry({ context: null, key: 'a', messages: { other: 'A' } }),
      makeTransEntry({ context: null, key: 'b', messages: { other: 'B' } }),
    ])
    assert.equal(Object.keys(po.translations['']).length, 2)
  })
})
