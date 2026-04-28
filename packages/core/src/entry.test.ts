import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkTransEntrySpecs,
  compareEntry,
  compareKeyReference,
  getPluralKeys,
  type KeyEntry,
  type TransEntry,
  toTransEntry,
} from './entry.js'

function makeTransEntry(overrides: Partial<TransEntry> = {}): TransEntry {
  return {
    context: overrides.context ?? null,
    key: overrides.key ?? 'k',
    messages: overrides.messages ?? {},
    flag: overrides.flag ?? null,
  }
}

describe('compareKeyReference', () => {
  it('compares by file when files differ', () => {
    assert.equal(compareKeyReference({ file: 'a.ts' }, { file: 'b.ts' }), -1)
    assert.equal(compareKeyReference({ file: 'b.ts' }, { file: 'a.ts' }), 1)
  })

  it('places null loc before defined loc on the same file', () => {
    assert.equal(compareKeyReference({ file: 'a.ts' }, { file: 'a.ts', loc: '10' }), -1)
    assert.equal(compareKeyReference({ file: 'a.ts', loc: '10' }, { file: 'a.ts' }), 1)
  })

  it('compares loc lexicographically on the same file', () => {
    assert.equal(compareKeyReference({ file: 'a.ts', loc: '10' }, { file: 'a.ts', loc: '20' }), -1)
    assert.equal(compareKeyReference({ file: 'a.ts', loc: '20' }, { file: 'a.ts', loc: '10' }), 1)
  })
})

describe('compareEntry', () => {
  it('compares by key when both contexts are null', () => {
    assert.equal(compareEntry({ context: null, key: 'a' }, { context: null, key: 'b' }), -1)
    assert.equal(compareEntry({ context: null, key: 'b' }, { context: null, key: 'a' }), 1)
  })

  it('returns 0 when both contexts are null and keys match', () => {
    assert.equal(compareEntry({ context: null, key: 'a' }, { context: null, key: 'a' }), 0)
  })

  it('places null context before defined context', () => {
    assert.equal(compareEntry({ context: null, key: 'a' }, { context: 'ctx', key: 'a' }), -1)
    assert.equal(compareEntry({ context: 'ctx', key: 'a' }, { context: null, key: 'a' }), 1)
  })

  it('compares by context when both contexts are defined', () => {
    assert.equal(compareEntry({ context: 'a', key: 'x' }, { context: 'b', key: 'x' }), -1)
    assert.equal(compareEntry({ context: 'b', key: 'x' }, { context: 'a', key: 'x' }), 1)
  })

  it('returns 0 when contexts match, regardless of key', () => {
    assert.equal(compareEntry({ context: 'ctx', key: 'a' }, { context: 'ctx', key: 'b' }), 0)
  })
})

describe('toTransEntry', () => {
  it('preserves context and key, empties messages, and nulls flag', () => {
    const keyEntry: KeyEntry = {
      context: 'ctx',
      key: 'greeting',
      isPlural: true,
      references: [{ file: 'a.ts', loc: '1' }],
      comments: ['hi'],
    }
    assert.deepEqual(toTransEntry(keyEntry), {
      context: 'ctx',
      key: 'greeting',
      messages: {},
      flag: null,
    })
  })

  it('keeps null context as null', () => {
    const keyEntry: KeyEntry = {
      context: null,
      key: 'k',
      isPlural: false,
      references: [],
      comments: [],
    }
    assert.equal(toTransEntry(keyEntry).context, null)
  })
})

describe('checkTransEntrySpecs', () => {
  describe('total', () => {
    it('matches "total" for any entry', () => {
      assert.equal(checkTransEntrySpecs(makeTransEntry(), ['total'], false), true)
    })

    it('does not match "!total"', () => {
      assert.equal(checkTransEntrySpecs(makeTransEntry(), ['!total'], false), false)
    })
  })

  describe('translated / untranslated', () => {
    it('treats an entry with "other" message and no unverified flag as translated', () => {
      const entry = makeTransEntry({ messages: { other: 'hi' } })
      assert.equal(checkTransEntrySpecs(entry, ['translated'], false), true)
      assert.equal(checkTransEntrySpecs(entry, ['untranslated'], false), false)
    })

    it('treats an entry without "other" message as untranslated', () => {
      const entry = makeTransEntry({ messages: {} })
      assert.equal(checkTransEntrySpecs(entry, ['translated'], false), false)
      assert.equal(checkTransEntrySpecs(entry, ['untranslated'], false), true)
    })

    it('treats unverified entries as untranslated unless useUnverified is true', () => {
      const entry = makeTransEntry({ messages: { other: 'hi' }, flag: 'unverified' })
      assert.equal(checkTransEntrySpecs(entry, ['translated'], false), false)
      assert.equal(checkTransEntrySpecs(entry, ['untranslated'], false), true)
      assert.equal(checkTransEntrySpecs(entry, ['translated'], true), true)
      assert.equal(checkTransEntrySpecs(entry, ['untranslated'], true), false)
    })

    it('inverts the result with the "!" prefix', () => {
      const entry = makeTransEntry({ messages: { other: 'hi' } })
      assert.equal(checkTransEntrySpecs(entry, ['!translated'], false), false)
      assert.equal(checkTransEntrySpecs(entry, ['!untranslated'], false), true)
    })
  })

  describe('flag matching', () => {
    it('matches when entry flag equals spec', () => {
      const entry = makeTransEntry({ flag: 'unverified' })
      assert.equal(checkTransEntrySpecs(entry, ['unverified'], false), true)
    })

    it('does not match when entry flag differs from spec', () => {
      const entry = makeTransEntry({ flag: 'fuzzy' })
      assert.equal(checkTransEntrySpecs(entry, ['unverified'], false), false)
    })

    it('inverts flag matching with the "!" prefix', () => {
      const entry = makeTransEntry({ flag: 'unverified' })
      assert.equal(checkTransEntrySpecs(entry, ['!unverified'], false), false)
      assert.equal(checkTransEntrySpecs(entry, ['!fuzzy'], false), true)
    })
  })

  describe('multiple specs', () => {
    it('returns true only when every spec matches', () => {
      const entry = makeTransEntry({ messages: { other: 'hi' }, flag: null })
      assert.equal(checkTransEntrySpecs(entry, ['translated', '!unverified'], false), true)
      assert.equal(checkTransEntrySpecs(entry, ['translated', 'unverified'], false), false)
    })
  })
})

describe('getPluralKeys', () => {
  it('returns ["other"] for locales that use only the other form', () => {
    for (const locale of ['ko', 'cn', 'id', 'ja', 'th']) {
      assert.deepEqual(getPluralKeys(locale), ['other'])
    }
  })

  it('returns ["one", "other"] for locales with one+other', () => {
    for (const locale of ['en', 'fr', 'es']) {
      assert.deepEqual(getPluralKeys(locale), ['one', 'other'])
    }
  })

  it('returns ["one", "few", "many", "other"] for ru', () => {
    assert.deepEqual(getPluralKeys('ru'), ['one', 'few', 'many', 'other'])
  })

  it('only uses the first two characters of the locale', () => {
    assert.deepEqual(getPluralKeys('en-US'), ['one', 'other'])
    assert.deepEqual(getPluralKeys('ko_KR'), ['other'])
  })

  it('throws for unsupported locales', () => {
    assert.throws(() => getPluralKeys('de'), /plural keys for de not supported/)
  })
})
