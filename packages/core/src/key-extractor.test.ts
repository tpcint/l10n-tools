import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { KeyExtractor } from './key-extractor.js'
import { readKeyEntries, writeKeyEntries } from './entry.js'

describe('KeyExtractor', () => {
  describe('id key', () => {
    it('records idKey attributes on the entry', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'publish_button', { idKey: { defaultValue: '공개', draft: true } })
      const entry = extractor.keys.find(null, 'publish_button')
      assert.deepEqual(entry?.idKey, { defaultValue: '공개', draft: true })
      assert.equal(entry?.context, null)
    })

    it('merges references when the same id key has the same attributes', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'publish_button', { idKey: { defaultValue: '공개', draft: false } })
      extractor.addMessage({ filename: 'b.xml', line: 5 }, 'publish_button', { idKey: { defaultValue: '공개', draft: false } })
      const entries = extractor.keys.toEntries()
      assert.equal(entries.length, 1)
      assert.deepEqual(entries[0].references, [{ file: 'a.xml', loc: '3' }, { file: 'b.xml', loc: '5' }])
    })

    it('throws when the same id key has a different default value', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'publish_button', { idKey: { defaultValue: '공개', draft: false } })
      assert.throws(
        () => extractor.addMessage({ filename: 'b.xml', line: 5 }, 'publish_button', { idKey: { defaultValue: '게시', draft: false } }),
        /conflicting key "publish_button" at b\.xml:5: id key \(default value "게시"\) differs from id key \(default value "공개"\) at a\.xml:3/,
      )
    })

    it('throws when the same id key has a different draft flag', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'policy', { idKey: { defaultValue: '정책', draft: true } })
      assert.throws(
        () => extractor.addMessage({ filename: 'b.xml', line: 5 }, 'policy', { idKey: { defaultValue: '정책', draft: false } }),
        /conflicting key "policy"/,
      )
    })

    it('throws when a key is added both as a source key and as an id key', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.ts', line: 1 }, 'username')
      assert.throws(
        () => extractor.addMessage({ filename: 'b.ts', line: 2 }, 'username', { idKey: { defaultValue: '사용자 이름', draft: false } }),
        /id key \(default value "사용자 이름"\) differs from source key/,
      )
    })

    it('throws when the same id key is both plural and non-plural', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'left_days', { idKey: { defaultValue: '%d일', draft: false } })
      assert.throws(
        () => extractor.addMessage({ filename: 'a.xml', line: 5 }, 'left_days', { isPlural: true, idKey: { defaultValue: '%d일', draft: false } }),
        /conflicting key "left_days" at a\.xml:5: plural differs from non-plural at a\.xml:3/,
      )
    })

    it('extracts a key that is also an Object.prototype property name', () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'constructor', { idKey: { defaultValue: '생성자', draft: false } })
      assert.deepEqual(extractor.keys.find(null, 'constructor')?.idKey, { defaultValue: '생성자', draft: false })
    })

    it('keeps idKey through writeKeyEntries and readKeyEntries', async () => {
      const extractor = new KeyExtractor()
      extractor.addMessage({ filename: 'a.xml', line: 3 }, 'publish_button', { idKey: { defaultValue: '공개', draft: true } })
      extractor.addMessage({ filename: 'a.ts', line: 1 }, '공개')
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'l10n-key-extractor-'))
      try {
        const keysPath = path.join(dir, 'keys.json')
        await writeKeyEntries(keysPath, extractor.keys.toEntries())
        const entries = await readKeyEntries(keysPath)
        assert.deepEqual(entries.find(entry => entry.key === 'publish_button')?.idKey, { defaultValue: '공개', draft: true })
        assert.equal('idKey' in entries.find(entry => entry.key === '공개')!, false)
      } finally {
        await fsp.rm(dir, { recursive: true, force: true })
      }
    })
  })
})
