import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as gettextParser from 'gettext-parser'
import { CompilerConfig, type TransEntry, writeTransEntries } from 'l10n-tools-core'
import {
  compileToMo,
  compileToPoJson,
  createPo,
  createPoEntry,
  mergePoTranslations,
  sortPoTranslations,
} from './compiler.js'

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

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeTransFiles(dir: string, perLocale: { [locale: string]: TransEntry[] }): Promise<void> {
  for (const [locale, entries] of Object.entries(perLocale)) {
    await writeTransEntries(path.join(dir, `trans-${locale}.json`), entries)
  }
}

function makePoJsonConfig(targetDir: string): CompilerConfig {
  return new CompilerConfig({ 'type': 'po-json', 'target-dir': targetDir } as never)
}

function makeMoConfig(targetDir: string): CompilerConfig {
  return new CompilerConfig({ 'type': 'mo', 'target-dir': targetDir } as never)
}

describe('mergePoTranslations', () => {
  it('replaces matching msgid entries from base with fresh values', () => {
    const base = createPo('d', 'en', [
      makeTransEntry({ key: 'keep', messages: { other: 'KEEP' } }),
      makeTransEntry({ key: 'drop', messages: { other: 'OLD' } }),
    ])
    const fresh = createPo('d', 'en', [
      makeTransEntry({ key: 'drop', messages: { other: 'NEW' } }),
    ])
    const merged = mergePoTranslations(base, fresh, new Set(['drop']))
    assert.equal(merged.translations[''].keep.msgstr[0], 'KEEP')
    assert.equal(merged.translations[''].drop.msgstr[0], 'NEW')
  })

  it('replaces only the (msgctxt, msgid) pairs present in fresh, preserving same-msgid in other contexts', () => {
    const base = createPo('d', 'en', [
      makeTransEntry({ context: 'menu', key: 'File', messages: { other: 'M-File' } }),
      makeTransEntry({ context: 'menu', key: 'keep', messages: { other: 'M-keep' } }),
      makeTransEntry({ context: 'toolbar', key: 'File', messages: { other: 'T-File' } }),
    ])
    const fresh = createPo('d', 'en', [
      makeTransEntry({ context: 'menu', key: 'File', messages: { other: 'M-File-NEW' } }),
    ])
    const merged = mergePoTranslations(base, fresh, new Set(['File']))
    assert.equal(merged.translations.menu.File.msgstr[0], 'M-File-NEW')
    assert.equal(merged.translations.menu.keep.msgstr[0], 'M-keep')
    // Same msgid in an unrelated msgctxt is preserved — fresh did not replace (toolbar, File).
    assert.equal(merged.translations.toolbar.File.msgstr[0], 'T-File')
  })

  it('preserves base entries whose pair is not in fresh, even when msgid happens to be in mergeKeys', () => {
    // Pins the contract: the merge unit is (msgctxt, msgid). mergeKeys never causes
    // deletions on its own — only fresh's contents drive replacements.
    const base = createPo('d', 'en', [
      makeTransEntry({ key: 'keep', messages: { other: 'KEEP' } }),
      makeTransEntry({ key: 'gone', messages: { other: 'X' } }),
    ])
    const fresh = createPo('d', 'en', [])
    const merged = mergePoTranslations(base, fresh, new Set(['gone']))
    assert.equal(merged.translations[''].gone.msgstr[0], 'X')
    assert.equal(merged.translations[''].keep.msgstr[0], 'KEEP')
  })

  it('preserves base headers and ignores fresh headers entry', () => {
    const base = createPo('myDomain', 'en', [])
    base.headers['Project-Id-Version'] = 'baseProject'
    const fresh = createPo('otherDomain', 'en', [])
    const merged = mergePoTranslations(base, fresh, new Set(['drop']))
    assert.equal(merged.headers['Project-Id-Version'], 'baseProject')
    // The empty-msgid header bucket under '' is still present (createPo populates it lazily).
    assert.ok(merged.translations[''])
  })

  it('does not mutate the base object', () => {
    const base = createPo('d', 'en', [
      makeTransEntry({ key: 'drop', messages: { other: 'OLD' } }),
    ])
    const fresh = createPo('d', 'en', [
      makeTransEntry({ key: 'drop', messages: { other: 'NEW' } }),
    ])
    mergePoTranslations(base, fresh, new Set(['drop']))
    assert.equal(base.translations[''].drop.msgstr[0], 'OLD')
  })
})

describe('sortPoTranslations', () => {
  it('keeps the empty msgctxt (header bucket) first and orders other msgctxts alphabetically', () => {
    const po = createPo('d', 'en', [
      makeTransEntry({ context: 'toolbar', key: 'a', messages: { other: 'A' } }),
      makeTransEntry({ context: 'menu', key: 'b', messages: { other: 'B' } }),
      makeTransEntry({ context: null, key: 'c', messages: { other: 'C' } }),
    ])
    const sorted = sortPoTranslations(po)
    assert.deepEqual(Object.keys(sorted.translations), ['', 'menu', 'toolbar'])
  })

  it('orders msgids alphabetically within each msgctxt', () => {
    const po = createPo('d', 'en', [
      makeTransEntry({ context: null, key: 'banana', messages: { other: 'B' } }),
      makeTransEntry({ context: null, key: 'apple', messages: { other: 'A' } }),
      makeTransEntry({ context: 'menu', key: 'zebra', messages: { other: 'Z' } }),
      makeTransEntry({ context: 'menu', key: 'aardvark', messages: { other: 'X' } }),
    ])
    const sorted = sortPoTranslations(po)
    assert.deepEqual(Object.keys(sorted.translations['']), ['apple', 'banana'])
    assert.deepEqual(Object.keys(sorted.translations['menu']), ['aardvark', 'zebra'])
  })

  it('handles po with only the empty msgctxt bucket (no headers entry yet)', () => {
    // createPo lazily populates the header msgid '' under the empty msgctxt only when headers are emitted.
    const po = createPo('d', 'en', [
      makeTransEntry({ key: 'b', messages: { other: 'B' } }),
      makeTransEntry({ key: 'a', messages: { other: 'A' } }),
    ])
    const sorted = sortPoTranslations(po)
    assert.deepEqual(Object.keys(sorted.translations), [''])
    assert.deepEqual(Object.keys(sorted.translations['']), ['a', 'b'])
  })

  it('preserves headers and entry values', () => {
    const po = createPo('d', 'en', [
      makeTransEntry({ key: 'b', messages: { other: 'B' } }),
      makeTransEntry({ key: 'a', messages: { other: 'A' } }),
    ])
    const sorted = sortPoTranslations(po)
    assert.equal(sorted.headers['Project-Id-Version'], 'd')
    assert.equal(sorted.translations[''].a.msgstr[0], 'A')
    assert.equal(sorted.translations[''].b.msgstr[0], 'B')
  })

  it('does not mutate the input po', () => {
    const po = createPo('d', 'en', [
      makeTransEntry({ context: 'toolbar', key: 'a', messages: { other: 'A' } }),
      makeTransEntry({ context: 'menu', key: 'b', messages: { other: 'B' } }),
    ])
    const beforeOuter = Object.keys(po.translations)
    sortPoTranslations(po)
    assert.deepEqual(Object.keys(po.translations), beforeOuter)
  })
})

describe('key order — compileToPoJson', () => {
  it('writes msgctxts and msgids in alphabetical order in non-merge mode', async () => {
    const dir = await makeTempDir('compile-pojson-order-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ context: 'toolbar', key: 'a', messages: { other: 'TA' } }),
          makeTransEntry({ context: null, key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ context: 'menu', key: 'b', messages: { other: 'MB' } }),
          makeTransEntry({ context: null, key: 'apple', messages: { other: 'A' } }),
        ],
      })

      await compileToPoJson('d', makePoJsonConfig(targetDir), transDir)

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'))
      assert.deepEqual(Object.keys(written.translations), ['', 'menu', 'toolbar'])
      assert.deepEqual(Object.keys(written.translations['']), ['apple', 'banana'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('produces the same key order in merge mode as in non-merge mode', async () => {
    // Regression: sync --source previously preserved the base file's msgid order
    // while `sync` produced compareEntry-sorted output, so the two paths could
    // diverge over time. Both paths must now converge on alphabetical order.
    const dir = await makeTempDir('compile-pojson-order-')
    try {
      const fullDir = path.join(dir, 'full')
      const mergeDir = path.join(dir, 'merge')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(fullDir)
      await fsp.mkdir(mergeDir)
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
          makeTransEntry({ key: 'cherry', messages: { other: 'C' } }),
        ],
      })

      await compileToPoJson('d', makePoJsonConfig(fullDir), transDir)

      // Seed merge target with deliberately shuffled msgid order.
      const baseShuffled = createPo('d', 'ko', [
        makeTransEntry({ key: 'cherry', messages: { other: 'OLD-C' } }),
        makeTransEntry({ key: 'banana', messages: { other: 'OLD-B' } }),
        makeTransEntry({ key: 'apple', messages: { other: 'OLD-A' } }),
      ])
      await fsp.writeFile(path.join(mergeDir, 'ko.json'), JSON.stringify(baseShuffled, null, 2))
      await compileToPoJson('d', makePoJsonConfig(mergeDir), transDir, {
        mergeKeys: new Set(['apple', 'banana', 'cherry']),
      })

      const fullJson = JSON.parse(await fsp.readFile(path.join(fullDir, 'ko.json'), 'utf-8'))
      const mergeJson = JSON.parse(await fsp.readFile(path.join(mergeDir, 'ko.json'), 'utf-8'))
      assert.deepEqual(
        Object.keys(mergeJson.translations['']),
        Object.keys(fullJson.translations['']),
      )
      assert.deepEqual(
        Object.keys(mergeJson.translations['']),
        ['apple', 'banana', 'cherry'],
      )
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('key order — compileToMo', () => {
  it('writes msgids in alphabetical order in non-merge mode', async () => {
    const dir = await makeTempDir('compile-mo-order-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
          makeTransEntry({ key: 'cherry', messages: { other: 'C' } }),
        ],
      })

      await compileToMo('d', makeMoConfig(targetDir), transDir)

      const buf = await fsp.readFile(path.join(targetDir, 'ko', 'LC_MESSAGES', 'd.mo'))
      const parsed = gettextParser.mo.parse(buf)
      const msgids = Object.keys(parsed.translations['']).filter(id => id !== '')
      assert.deepEqual(msgids, ['apple', 'banana', 'cherry'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('produces the same .mo bytes whether compiled fresh or via merge from a shuffled base', async () => {
    // End-to-end regression: with sortPoTranslations applied on both paths, the
    // .mo output is byte-identical regardless of how the base file was ordered.
    const dir = await makeTempDir('compile-mo-order-')
    try {
      const fullDir = path.join(dir, 'full')
      const mergeDir = path.join(dir, 'merge')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
        ],
      })

      await compileToMo('d', makeMoConfig(fullDir), transDir)

      // Seed merge target with shuffled msgid order.
      const moDir = path.join(mergeDir, 'ko', 'LC_MESSAGES')
      await fsp.mkdir(moDir, { recursive: true })
      const baseShuffled = createPo('d', 'ko', [
        makeTransEntry({ key: 'banana', messages: { other: 'OLD-B' } }),
        makeTransEntry({ key: 'apple', messages: { other: 'OLD-A' } }),
      ])
      await fsp.writeFile(path.join(moDir, 'd.mo'), gettextParser.mo.compile(baseShuffled))

      await compileToMo('d', makeMoConfig(mergeDir), transDir, {
        mergeKeys: new Set(['apple', 'banana']),
      })

      const fullBytes = await fsp.readFile(path.join(fullDir, 'ko', 'LC_MESSAGES', 'd.mo'))
      const mergeBytes = await fsp.readFile(path.join(moDir, 'd.mo'))
      assert.deepEqual(Buffer.from(mergeBytes), Buffer.from(fullBytes))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('compileToPoJson with mergeKeys', () => {
  it('updates only PR keys in the per-locale PO JSON output', async () => {
    const dir = await makeTempDir('compile-pojson-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)

      const baseKo = createPo('d', 'ko', [
        makeTransEntry({ key: 'keep', messages: { other: '유지' } }),
        makeTransEntry({ key: 'drop', messages: { other: '낡은' } }),
      ])
      await fsp.writeFile(path.join(targetDir, 'ko.json'), JSON.stringify(baseKo, null, 2))

      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'drop', messages: { other: '새' } })],
      })

      await compileToPoJson('d', makePoJsonConfig(targetDir), transDir, {
        mergeKeys: new Set(['drop']),
      })

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'))
      assert.equal(written.translations[''].keep.msgstr[0], '유지')
      assert.equal(written.translations[''].drop.msgstr[0], '새')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not touch any locale file when mergeKeys is empty', async () => {
    const dir = await makeTempDir('compile-pojson-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      const original = JSON.stringify(createPo('d', 'ko', [
        makeTransEntry({ key: 'keep', messages: { other: '유지' } }),
      ]), null, 2)
      await fsp.writeFile(path.join(targetDir, 'ko.json'), original)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'unrelated', messages: { other: 'X' } })],
      })

      await compileToPoJson('d', makePoJsonConfig(targetDir), transDir, {
        mergeKeys: new Set(),
      })

      const after = await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8')
      assert.equal(after, original)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes only PR keys when the locale PO JSON file does not exist yet', async () => {
    const dir = await makeTempDir('compile-pojson-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'a', messages: { other: 'A' } })],
      })

      await compileToPoJson('d', makePoJsonConfig(targetDir), transDir, {
        mergeKeys: new Set(['a']),
      })

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'))
      assert.equal(written.translations[''].a.msgstr[0], 'A')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('overwrites the entire file when mergeKeys is not provided', async () => {
    const dir = await makeTempDir('compile-pojson-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      await fsp.writeFile(path.join(targetDir, 'ko.json'),
        JSON.stringify(createPo('d', 'ko', [makeTransEntry({ key: 'stale', messages: { other: 'X' } })])))
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'fresh', messages: { other: 'F' } })],
      })

      await compileToPoJson('d', makePoJsonConfig(targetDir), transDir)

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'))
      assert.equal(written.translations[''].stale, undefined)
      assert.equal(written.translations[''].fresh.msgstr[0], 'F')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('compileToMo with mergeKeys', () => {
  it('updates only PR keys in the per-locale .mo binary', async () => {
    const dir = await makeTempDir('compile-mo-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)

      // Seed an existing .mo file with two keys.
      const moDir = path.join(targetDir, 'ko', 'LC_MESSAGES')
      await fsp.mkdir(moDir, { recursive: true })
      const baseKo = createPo('d', 'ko', [
        makeTransEntry({ key: 'keep', messages: { other: '유지' } }),
        makeTransEntry({ key: 'drop', messages: { other: '낡은' } }),
      ])
      await fsp.writeFile(path.join(moDir, 'd.mo'), gettextParser.mo.compile(baseKo))

      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'drop', messages: { other: '새' } })],
      })

      await compileToMo('d', makeMoConfig(targetDir), transDir, {
        mergeKeys: new Set(['drop']),
      })

      const buf = await fsp.readFile(path.join(moDir, 'd.mo'))
      const parsed = gettextParser.mo.parse(buf)
      assert.equal(parsed.translations[''].keep.msgstr[0], '유지')
      assert.equal(parsed.translations[''].drop.msgstr[0], '새')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not touch any .mo file when mergeKeys is empty', async () => {
    const dir = await makeTempDir('compile-mo-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      const moDir = path.join(targetDir, 'ko', 'LC_MESSAGES')
      await fsp.mkdir(moDir, { recursive: true })
      const baseKo = createPo('d', 'ko', [
        makeTransEntry({ key: 'keep', messages: { other: '유지' } }),
      ])
      const originalBytes = gettextParser.mo.compile(baseKo)
      await fsp.writeFile(path.join(moDir, 'd.mo'), originalBytes)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'unrelated', messages: { other: 'X' } })],
      })

      await compileToMo('d', makeMoConfig(targetDir), transDir, {
        mergeKeys: new Set(),
      })

      const after = await fsp.readFile(path.join(moDir, 'd.mo'))
      assert.deepEqual(Buffer.from(after), Buffer.from(originalBytes))
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes only PR keys when the locale .mo file does not exist yet', async () => {
    const dir = await makeTempDir('compile-mo-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'a', messages: { other: 'A' } })],
      })

      await compileToMo('d', makeMoConfig(targetDir), transDir, {
        mergeKeys: new Set(['a']),
      })

      const moPath = path.join(targetDir, 'ko', 'LC_MESSAGES', 'd.mo')
      const buf = await fsp.readFile(moPath)
      const parsed = gettextParser.mo.parse(buf)
      assert.equal(parsed.translations[''].a.msgstr[0], 'A')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
