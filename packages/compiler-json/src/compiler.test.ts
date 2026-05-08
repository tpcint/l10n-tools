import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CompilerConfig, type TransEntry, writeTransEntries } from 'l10n-tools-core'
import {
  buildJsonTrans,
  compileToJson,
  compileToJsonDir,
  jsonKeyMatchesMergeKeys,
  mergeJsonTrans,
  sortJsonTrans,
} from './compiler.js'

function makeTransEntry(overrides: Partial<TransEntry> = {}): TransEntry {
  return {
    context: overrides.context ?? null,
    key: overrides.key ?? 'k',
    messages: overrides.messages ?? { other: 'translated' },
    flag: overrides.flag ?? null,
  }
}

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeTransFiles(
  dir: string,
  perLocale: { [locale: string]: TransEntry[] },
): Promise<void> {
  for (const [locale, entries] of Object.entries(perLocale)) {
    await writeTransEntries(path.join(dir, `trans-${locale}.json`), entries)
  }
}

function makeJsonConfig(targetPath: string): CompilerConfig {
  return new CompilerConfig({ 'type': 'json', 'target-path': targetPath } as never)
}

function makeJsonDirConfig(targetDir: string, useLocaleKey = false): CompilerConfig {
  return new CompilerConfig({
    'type': 'json-dir',
    'target-dir': targetDir,
    'use-locale-key': useLocaleKey,
  } as never)
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

describe('jsonKeyMatchesMergeKeys', () => {
  it('matches direct key membership', () => {
    const set = new Set(['a', 'b'])
    assert.equal(jsonKeyMatchesMergeKeys('a', set), true)
    assert.equal(jsonKeyMatchesMergeKeys('c', set), false)
  })

  it('does not match plural-suffixed keys without i18next pluralType', () => {
    const set = new Set(['item'])
    assert.equal(jsonKeyMatchesMergeKeys('item_one', set), false)
    assert.equal(jsonKeyMatchesMergeKeys('item_other', set), false)
  })

  it('matches `${key}_<form>` when pluralType is i18next', () => {
    const set = new Set(['item'])
    for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) {
      assert.equal(
        jsonKeyMatchesMergeKeys(`item_${form}`, set, 'i18next'),
        true,
        `expected match for item_${form}`,
      )
    }
    assert.equal(jsonKeyMatchesMergeKeys('item_unknown', set, 'i18next'), false)
    assert.equal(jsonKeyMatchesMergeKeys('other_item_one', set, 'i18next'), false)
  })

  it('still matches direct hits in i18next mode', () => {
    const set = new Set(['weird_key'])
    assert.equal(jsonKeyMatchesMergeKeys('weird_key', set, 'i18next'), true)
  })
})

describe('mergeJsonTrans', () => {
  it('replaces matching keys from base with fresh values', () => {
    const base = { a: 'old A', b: 'B', c: 'C' }
    const fresh = { a: 'new A' }
    const result = mergeJsonTrans(base, fresh, new Set(['a']))
    assert.deepEqual(result, { a: 'new A', b: 'B', c: 'C' })
  })

  it('removes mergeKeys from base when fresh has no value', () => {
    const base = { a: 'A', b: 'B' }
    const fresh = {}
    const result = mergeJsonTrans(base, fresh, new Set(['a']))
    assert.deepEqual(result, { b: 'B' })
  })

  it('adds fresh keys not already in base', () => {
    const base = { b: 'B' }
    const fresh = { a: 'A' }
    const result = mergeJsonTrans(base, fresh, new Set(['a']))
    assert.deepEqual(result, { a: 'A', b: 'B' })
  })

  it('does not mutate the base object', () => {
    const base = { a: 'old', b: 'B' }
    mergeJsonTrans(base, { a: 'new' }, new Set(['a']))
    assert.deepEqual(base, { a: 'old', b: 'B' })
  })

  it('clears all i18next plural-suffixed forms of a mergeKey, even when fresh has fewer forms', () => {
    const base = { item_zero: '0', item_one: '1', item_other: 'many', greet: 'hi' }
    const fresh = { item_one: 'one', item_other: 'others' }
    const result = mergeJsonTrans(base, fresh, new Set(['item']), 'i18next')
    assert.deepEqual(result, { item_one: 'one', item_other: 'others', greet: 'hi' })
  })

  it('preserves i18next-suffixed keys that do not belong to mergeKeys', () => {
    const base = { item_one: '1', other_one: 'X' }
    const fresh = { item_one: 'one' }
    const result = mergeJsonTrans(base, fresh, new Set(['item']), 'i18next')
    assert.deepEqual(result, { item_one: 'one', other_one: 'X' })
  })

  it('does not let fresh keys outside mergeKeys overwrite base', () => {
    // Defensive: fresh is normally produced from PR-scope trans only, but if an
    // unrelated key ever leaks in, the merge must not propagate it.
    const base = { keep: 'BASE' }
    const fresh = { keep: 'LEAKED', drop: 'NEW' }
    const result = mergeJsonTrans(base, fresh, new Set(['drop']))
    assert.deepEqual(result, { keep: 'BASE', drop: 'NEW' })
  })

  it('does not let fresh i18next plural keys outside mergeKeys overwrite base', () => {
    const base = { keep_one: 'BASE-one', keep_other: 'BASE-many' }
    const fresh = { keep_one: 'LEAKED', drop_one: 'NEW-one', drop_other: 'NEW-many' }
    const result = mergeJsonTrans(base, fresh, new Set(['drop']), 'i18next')
    assert.deepEqual(result, {
      keep_one: 'BASE-one',
      keep_other: 'BASE-many',
      drop_one: 'NEW-one',
      drop_other: 'NEW-many',
    })
  })
})

describe('sortJsonTrans', () => {
  it('reinserts keys in alphabetical order', () => {
    const sorted = sortJsonTrans({ b: 'B', a: 'A', c: 'C' })
    assert.deepEqual(Object.keys(sorted), ['a', 'b', 'c'])
  })

  it('preserves the value for each key', () => {
    const sorted = sortJsonTrans({ b: 'B', a: 'A' })
    assert.deepEqual(sorted, { a: 'A', b: 'B' })
  })

  it('does not mutate the input object', () => {
    const input = { b: 'B', a: 'A' }
    sortJsonTrans(input)
    assert.deepEqual(Object.keys(input), ['b', 'a'])
  })

  it('handles object values (node-i18n shape)', () => {
    const sorted = sortJsonTrans({ b: { other: 'B' }, a: { one: '1', other: 'A' } })
    assert.deepEqual(Object.keys(sorted), ['a', 'b'])
  })
})

describe('key order — compileToJson', () => {
  it('writes keys in alphabetical order in non-merge mode', async () => {
    const dir = await makeTempDir('compile-json-order-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
          makeTransEntry({ key: 'cherry', messages: { other: 'C' } }),
        ],
      })

      await compileToJson('d', makeJsonConfig(targetPath), transDir)

      const written = JSON.parse(await fsp.readFile(targetPath, 'utf-8'))
      assert.deepEqual(Object.keys(written.ko), ['apple', 'banana', 'cherry'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('produces the same key order in merge mode as in non-merge mode', async () => {
    // Regression: `sync --source` (merge mode) used to leave merged keys at the
    // end of the object, producing a different order than `sync` (non-merge).
    // Both paths must converge on the same alphabetical key order.
    const dir = await makeTempDir('compile-json-order-')
    try {
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
          makeTransEntry({ key: 'cherry', messages: { other: 'C' } }),
        ],
      })

      const fullPath = path.join(dir, 'full.json')
      await compileToJson('d', makeJsonConfig(fullPath), transDir)

      // Merge path: start with a base file whose keys are deliberately in a
      // different (non-alphabetical) order, then merge in the same set.
      const mergePath = path.join(dir, 'merge.json')
      await fsp.writeFile(mergePath, JSON.stringify({
        ko: { cherry: 'OLD-C', banana: 'OLD-B', apple: 'OLD-A' },
      }, null, 2))
      await compileToJson('d', makeJsonConfig(mergePath), transDir, {
        mergeKeys: new Set(['apple', 'banana', 'cherry']),
      })

      const fullJson = JSON.parse(await fsp.readFile(fullPath, 'utf-8'))
      const mergeJson = JSON.parse(await fsp.readFile(mergePath, 'utf-8'))
      assert.deepEqual(Object.keys(mergeJson.ko), Object.keys(fullJson.ko))
      assert.deepEqual(Object.keys(mergeJson.ko), ['apple', 'banana', 'cherry'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('sorts a partial merge so PR keys interleave with preserved base keys', async () => {
    const dir = await makeTempDir('compile-json-order-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await fsp.writeFile(targetPath, JSON.stringify({
        ko: { cherry: 'C', apple: 'A' },
      }, null, 2))
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'banana', messages: { other: 'B' } })],
      })

      await compileToJson('d', makeJsonConfig(targetPath), transDir, {
        mergeKeys: new Set(['banana']),
      })

      const written = JSON.parse(await fsp.readFile(targetPath, 'utf-8'))
      assert.deepEqual(Object.keys(written.ko), ['apple', 'banana', 'cherry'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('key order — compileToJsonDir', () => {
  it('writes keys in alphabetical order in non-merge mode', async () => {
    const dir = await makeTempDir('compile-jsondir-order-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
        ],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(targetDir), transDir)

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'))
      assert.deepEqual(Object.keys(written), ['apple', 'banana'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('matches non-merge order in merge mode despite a shuffled base file', async () => {
    const dir = await makeTempDir('compile-jsondir-order-')
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
        ],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(fullDir), transDir)

      await fsp.writeFile(path.join(mergeDir, 'ko.json'),
        JSON.stringify({ banana: 'OLD-B', apple: 'OLD-A' }, null, 2))
      await compileToJsonDir()('d', makeJsonDirConfig(mergeDir), transDir, {
        mergeKeys: new Set(['apple', 'banana']),
      })

      const fullJson = JSON.parse(await fsp.readFile(path.join(fullDir, 'ko.json'), 'utf-8'))
      const mergeJson = JSON.parse(await fsp.readFile(path.join(mergeDir, 'ko.json'), 'utf-8'))
      assert.deepEqual(Object.keys(mergeJson), Object.keys(fullJson))
      assert.deepEqual(Object.keys(mergeJson), ['apple', 'banana'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('sorts i18next plural-suffixed keys alphabetically alongside non-plural keys', async () => {
    const dir = await makeTempDir('compile-jsondir-order-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        en: [
          makeTransEntry({ key: 'item', messages: { one: '1', other: 'many' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
          makeTransEntry({ key: 'zebra', messages: { other: 'Z' } }),
        ],
      })

      await compileToJsonDir('i18next')('d', new CompilerConfig({
        'type': 'i18next',
        'target-dir': targetDir,
      } as never), transDir)

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'en.json'), 'utf-8'))
      assert.deepEqual(Object.keys(written), ['apple', 'item_one', 'item_other', 'zebra'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves the locale key wrapper when sorting', async () => {
    const dir = await makeTempDir('compile-jsondir-order-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [
          makeTransEntry({ key: 'banana', messages: { other: 'B' } }),
          makeTransEntry({ key: 'apple', messages: { other: 'A' } }),
        ],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(targetDir, true), transDir)

      const written = JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'))
      assert.deepEqual(Object.keys(written), ['ko'])
      assert.deepEqual(Object.keys(written.ko), ['apple', 'banana'])
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('compileToJson with mergeKeys', () => {
  it('updates only PR keys in the existing single-file output', async () => {
    const dir = await makeTempDir('compile-json-merge-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)

      // Existing output: ko has both keep + drop keys; en has keep only.
      await fsp.writeFile(targetPath, JSON.stringify({
        ko: { keep: '유지', drop: '낡은값' },
        en: { keep: 'keep' },
      }, null, 2))

      // PR snapshot only contains "drop" (now refreshed).
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'drop', messages: { other: '새값' } })],
        en: [makeTransEntry({ key: 'drop', messages: { other: 'fresh' } })],
      })

      const config = makeJsonConfig(targetPath)
      await compileToJson('d', config, transDir, { mergeKeys: new Set(['drop']) })

      const written = JSON.parse(await fsp.readFile(targetPath, 'utf-8'))
      assert.deepEqual(written, {
        ko: { keep: '유지', drop: '새값' },
        en: { keep: 'keep', drop: 'fresh' },
      })
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('removes PR keys from the output when fresh translation is empty', async () => {
    const dir = await makeTempDir('compile-json-merge-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await fsp.writeFile(targetPath, JSON.stringify({
        ko: { keep: '유지', drop: '제거대상' },
      }, null, 2))
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'drop', messages: {} })],
      })

      await compileToJson('d', makeJsonConfig(targetPath), transDir, {
        mergeKeys: new Set(['drop']),
      })

      const written = JSON.parse(await fsp.readFile(targetPath, 'utf-8'))
      assert.deepEqual(written, { ko: { keep: '유지' } })
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not touch the output when mergeKeys is empty', async () => {
    const dir = await makeTempDir('compile-json-merge-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      const original = JSON.stringify({ ko: { keep: '유지' } }, null, 2)
      await fsp.writeFile(targetPath, original)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'unrelated', messages: { other: 'X' } })],
      })

      await compileToJson('d', makeJsonConfig(targetPath), transDir, {
        mergeKeys: new Set(),
      })

      const after = await fsp.readFile(targetPath, 'utf-8')
      assert.equal(after, original)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes only PR keys when the output file does not exist yet', async () => {
    const dir = await makeTempDir('compile-json-merge-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'a', messages: { other: 'A' } })],
        en: [makeTransEntry({ key: 'a', messages: { other: 'A-en' } })],
      })

      await compileToJson('d', makeJsonConfig(targetPath), transDir, {
        mergeKeys: new Set(['a']),
      })

      const written = JSON.parse(await fsp.readFile(targetPath, 'utf-8'))
      assert.deepEqual(written, {
        ko: { a: 'A' },
        en: { a: 'A-en' },
      })
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('overwrites the entire file when mergeKeys is not provided', async () => {
    const dir = await makeTempDir('compile-json-merge-')
    try {
      const targetPath = path.join(dir, 'out.json')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await fsp.writeFile(targetPath, JSON.stringify({ ko: { stale: 'X' } }))
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'fresh', messages: { other: 'F' } })],
      })

      await compileToJson('d', makeJsonConfig(targetPath), transDir)

      const written = JSON.parse(await fsp.readFile(targetPath, 'utf-8'))
      assert.deepEqual(written, { ko: { fresh: 'F' } })
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('compileToJsonDir with mergeKeys', () => {
  it('updates only PR keys per locale, preserving other keys', async () => {
    const dir = await makeTempDir('compile-jsondir-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      await fsp.writeFile(path.join(targetDir, 'ko.json'),
        JSON.stringify({ keep: '유지', drop: '낡은' }, null, 2))
      await fsp.writeFile(path.join(targetDir, 'en.json'),
        JSON.stringify({ keep: 'keep', drop: 'old' }, null, 2))
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'drop', messages: { other: '새' } })],
        en: [makeTransEntry({ key: 'drop', messages: { other: 'new' } })],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(targetDir), transDir, {
        mergeKeys: new Set(['drop']),
      })

      assert.deepEqual(
        JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8')),
        { keep: '유지', drop: '새' },
      )
      assert.deepEqual(
        JSON.parse(await fsp.readFile(path.join(targetDir, 'en.json'), 'utf-8')),
        { keep: 'keep', drop: 'new' },
      )
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('reads base from useLocaleKey wrapper and writes back wrapped', async () => {
    const dir = await makeTempDir('compile-jsondir-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      await fsp.writeFile(path.join(targetDir, 'ko.json'),
        JSON.stringify({ ko: { keep: '유지', drop: '낡은' } }, null, 2))
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'drop', messages: { other: '새' } })],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(targetDir, true), transDir, {
        mergeKeys: new Set(['drop']),
      })

      assert.deepEqual(
        JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8')),
        { ko: { keep: '유지', drop: '새' } },
      )
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not touch any locale file when mergeKeys is empty', async () => {
    const dir = await makeTempDir('compile-jsondir-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      const koOriginal = JSON.stringify({ keep: '유지' }, null, 2)
      const enOriginal = JSON.stringify({ keep: 'keep' }, null, 2)
      await fsp.writeFile(path.join(targetDir, 'ko.json'), koOriginal)
      await fsp.writeFile(path.join(targetDir, 'en.json'), enOriginal)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'unrelated', messages: { other: 'X' } })],
        en: [makeTransEntry({ key: 'unrelated', messages: { other: 'X' } })],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(targetDir), transDir, {
        mergeKeys: new Set(),
      })

      assert.equal(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8'), koOriginal)
      assert.equal(await fsp.readFile(path.join(targetDir, 'en.json'), 'utf-8'), enOriginal)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes only PR keys when the locale file does not exist yet', async () => {
    const dir = await makeTempDir('compile-jsondir-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(transDir)
      await writeTransFiles(transDir, {
        ko: [makeTransEntry({ key: 'a', messages: { other: 'A' } })],
      })

      await compileToJsonDir()('d', makeJsonDirConfig(targetDir), transDir, {
        mergeKeys: new Set(['a']),
      })

      assert.deepEqual(
        JSON.parse(await fsp.readFile(path.join(targetDir, 'ko.json'), 'utf-8')),
        { a: 'A' },
      )
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('clears all i18next plural-suffixed forms of a mergeKey from the base', async () => {
    const dir = await makeTempDir('compile-jsondir-merge-')
    try {
      const targetDir = path.join(dir, 'out')
      const transDir = path.join(dir, 'trans')
      await fsp.mkdir(targetDir)
      await fsp.mkdir(transDir)
      await fsp.writeFile(path.join(targetDir, 'en.json'),
        JSON.stringify({ keep: 'keep', item_zero: '0', item_one: '1', item_other: 'many' }, null, 2))
      await writeTransFiles(transDir, {
        en: [makeTransEntry({ key: 'item', messages: { one: 'one', other: 'others' } })],
      })

      await compileToJsonDir('i18next')('d', new CompilerConfig({
        'type': 'i18next',
        'target-dir': targetDir,
      } as never), transDir, { mergeKeys: new Set(['item']) })

      assert.deepEqual(
        JSON.parse(await fsp.readFile(path.join(targetDir, 'en.json'), 'utf-8')),
        { keep: 'keep', item_one: 'one', item_other: 'others' },
      )
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
