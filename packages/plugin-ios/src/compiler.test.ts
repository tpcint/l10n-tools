import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateStringsFile, transformIosPluralMessages } from './compiler.js'

describe('generateStringsFile', () => {
  it('emits a "msgid" = "msgstr"; pair for plain string values', () => {
    const output = generateStringsFile({ hello: 'world' })
    assert.equal(output, '\n"hello" = "world";\n')
  })

  it('emits text from object values', () => {
    const output = generateStringsFile({ hello: { text: 'world' } })
    assert.equal(output, '\n"hello" = "world";\n')
  })

  it('writes a comment line above the entry when present', () => {
    const output = generateStringsFile({ hello: { text: 'world', comment: 'greeting' } })
    assert.equal(output, '\n/* greeting */\n"hello" = "world";\n')
  })

  it('escapes backslashes', () => {
    const output = generateStringsFile({ k: 'a\\b' })
    assert.equal(output, '\n"k" = "a\\\\b";\n')
  })

  it('escapes double quotes', () => {
    const output = generateStringsFile({ k: 'a"b' })
    assert.equal(output, '\n"k" = "a\\"b";\n')
  })

  it('escapes newlines in keys and values', () => {
    const output = generateStringsFile({ 'a\nb': 'x\ny' })
    assert.equal(output, '\n"a\\nb" = "x\\ny";\n')
  })

  it('emits an empty string when no entries are given', () => {
    assert.equal(generateStringsFile({}), '')
  })

  it('emits empty msgstr when text is missing on object value', () => {
    const output = generateStringsFile({ k: { comment: 'c' } })
    assert.equal(output, '\n/* c */\n"k" = "";\n')
  })
})

describe('transformIosPluralMessages', () => {
  it('replaces a count format with %li', () => {
    const result = transformIosPluralMessages('en', 'k', { one: '%d item', other: '%d items' })
    assert.deepEqual(result, { one: '%li item', other: '%li items' })
  })

  it('keeps an existing %li unchanged', () => {
    const result = transformIosPluralMessages('en', 'k', { other: '%li items' })
    assert.deepEqual(result, { other: '%li items' })
  })

  it('preserves %u and similar specifiers by replacing with %li', () => {
    const result = transformIosPluralMessages('en', 'k', { other: '%u items' })
    assert.deepEqual(result, { other: '%li items' })
  })

  it('throws when no count format is present in the message', () => {
    assert.throws(
      () => transformIosPluralMessages('en', 'apple', { one: 'one apple', other: 'apples' }),
      /"one" of "apple": count format should be the first/,
    )
  })

  it('includes locale and key in the error message', () => {
    assert.throws(
      () => transformIosPluralMessages('ko', 'apple', { other: 'apples' }),
      /\[ko\] "other" of "apple"/,
    )
  })
})
