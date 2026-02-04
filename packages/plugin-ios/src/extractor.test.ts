import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { KeyExtractor } from 'l10n-tools-core'
import { extractSwiftPropertyAccess } from './extractor.js'

function expectKeyEntry(
  extractor: KeyExtractor,
  key: string,
  file?: string,
  loc?: string,
) {
  const keyEntry = extractor.keys.find(null, key)
  assert.notEqual(keyEntry, null, `key not found: ${key}`)
  if (file != null && loc != null) {
    assert(keyEntry!.references.some(reference => reference.file === file && reference.loc === loc))
  }
}

describe('extractSwiftPropertyAccess', () => {
  describe('single-line strings', () => {
    it('extracts "string".localized pattern', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello, World!".localized
let greeting = "Welcome".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello, World!', 'test.swift', '2')
      expectKeyEntry(extractor, 'Welcome', 'test.swift', '3')
    })

    it('extracts with escaped characters', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello, \\"World\\"!".localized
let tab = "Tab\\there".localized
let newline = "Line1\\nLine2".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello, "World"!')
      expectKeyEntry(extractor, 'Tab\there')
      expectKeyEntry(extractor, 'Line1\nLine2')
    })

    it('handles literal backslash correctly', () => {
      const extractor = new KeyExtractor()
      // Swift: "text\\nmore" means backslash followed by 'n', not newline
      const src = 'let message = "text\\\\nmore".localized'
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'text\\nmore')
    })

    it('handles Unicode escape sequences', () => {
      const extractor = new KeyExtractor()
      // Swift: \u{...} for Unicode scalars (1-8 hex digits)
      const src = String.raw`let emoji = "Hello \u{1F600}".localized
let heart = "\u{2764}\u{FE0F}".localized`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello 😀')
      expectKeyEntry(extractor, '❤️')
    })

    it('extracts with multiple keywords', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello".localized
let formatted = "Hello %@".localizedFormat
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized', 'localizedFormat'])
      expectKeyEntry(extractor, 'Hello')
      expectKeyEntry(extractor, 'Hello %@')
    })

    it('handles whitespace around dot', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello"  .  localized
let another = "World"
    .localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello')
      expectKeyEntry(extractor, 'World')
    })

    it('extracts method call pattern with parentheses', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello".localized()
let greeting = "Welcome".localized(comment: "greeting message")
let formatted = "Hello %@".localized(comment: "greeting", args: name)
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello', 'test.swift', '2')
      expectKeyEntry(extractor, 'Welcome', 'test.swift', '3')
      expectKeyEntry(extractor, 'Hello %@', 'test.swift', '4')
    })
  })

  describe('multi-line strings', () => {
    it('extracts """string""".localized pattern', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = """
Hello, World!
This is a multi-line string.
""".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello, World!\nThis is a multi-line string.')
    })

    it('handles indentation in multi-line strings', () => {
      const extractor = new KeyExtractor()
      // In Swift, closing """ indentation determines how much to strip
      // Here we test with closing """ at start of line (no indentation to strip)
      const src = `
let message = """
Line 1
Line 2
""".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Line 1\nLine 2')
    })

    it('strips common indentation in multi-line strings', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = """
    Line 1
    Line 2
""".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Line 1\nLine 2')
    })

    it('skips empty multi-line strings', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = """
""".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      // Empty strings are skipped
      assert.equal(extractor.keys.toEntries().length, 0)
    })

    it('handles escape sequences in multi-line strings', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = """
Hello\\tWorld
Line1\\nLine2
""".localized
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      expectKeyEntry(extractor, 'Hello\tWorld\nLine1\nLine2')
    })
  })

  describe('edge cases', () => {
    it('does not extract when no keywords provided', () => {
      const extractor = new KeyExtractor()
      const src = 'let message = "Hello".localized'
      extractSwiftPropertyAccess(extractor, 'test.swift', src, [])
      assert.equal(extractor.keys.toEntries().length, 0)
    })

    it('does not extract non-matching patterns', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello".uppercased
let another = "World".count
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      assert.equal(extractor.keys.toEntries().length, 0)
    })

    it('does not match keyword as substring', () => {
      const extractor = new KeyExtractor()
      const src = `
let message = "Hello".localizedValue
let another = "World".unlocalizedString
`
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['localized'])
      assert.equal(extractor.keys.toEntries().length, 0)
    })

    it('escapes special regex characters in keywords', () => {
      const extractor = new KeyExtractor()
      const src = 'let message = "Hello".l10n'
      extractSwiftPropertyAccess(extractor, 'test.swift', src, ['l10n'])
      expectKeyEntry(extractor, 'Hello')
    })
  })
})
