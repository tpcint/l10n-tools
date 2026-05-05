import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import i18nStringsFiles from 'i18n-strings-files'
import { CompilerConfig, type TransEntry, writeTransEntries } from 'l10n-tools-core'
import { compileToIosStrings, generateStringsFile, shouldProcessKey, transformIosPluralMessages } from './compiler.js'

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

describe('shouldProcessKey', () => {
  const transEntries: TransEntry[] = [
    { context: 'NSCameraUsageDescription', key: 'Need camera', messages: { other: '카메라' }, flag: null },
    { context: null, key: 'Hello', messages: { other: '안녕' }, flag: null },
  ]

  it('always processes keys when mergeKeys is undefined', () => {
    assert.equal(shouldProcessKey('AnyKey', transEntries, undefined), true)
  })

  it('matches by context when entry has a context', () => {
    assert.equal(shouldProcessKey('NSCameraUsageDescription', transEntries, new Set(['Need camera'])), true)
  })

  it('matches by key when entry has no context', () => {
    assert.equal(shouldProcessKey('Hello', transEntries, new Set(['Hello'])), true)
  })

  it('returns false when no trans entry corresponds to the key', () => {
    assert.equal(shouldProcessKey('UnrelatedKey', transEntries, new Set(['Need camera', 'Hello'])), false)
  })
})

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

function makeIosConfig(srcDir: string): CompilerConfig {
  return new CompilerConfig({ 'type': 'ios', 'src-dir': srcDir } as never)
}

async function writeTransFiles(dir: string, perLocale: { [locale: string]: TransEntry[] }): Promise<void> {
  for (const [locale, entries] of Object.entries(perLocale)) {
    await writeTransEntries(path.join(dir, `trans-${locale}.json`), entries)
  }
}

describe('compileToIosStrings InfoPlist with mergeKeys', () => {
  it('updates only PR-N InfoPlist entry, preserving others', async () => {
    const dir = await makeTempDir('compile-ios-merge-')
    try {
      const srcDir = path.join(dir, 'src')
      const transDir = path.join(dir, 'trans')
      const lprojDir = path.join(srcDir, 'ko.lproj')
      await fsp.mkdir(lprojDir, { recursive: true })
      await fsp.mkdir(transDir)
      const stringsPath = path.join(lprojDir, 'InfoPlist.strings')

      // Base output: two keys translated.
      await fsp.writeFile(stringsPath,
        '\n"NSCameraUsageDescription" = "기존카메라";\n' +
        '\n"NSMicrophoneUsageDescription" = "기존마이크";\n',
        { encoding: 'utf-8' },
      )

      // PR-N has only NSCameraUsageDescription.
      await writeTransFiles(transDir, {
        ko: [{ context: 'NSCameraUsageDescription', key: 'Camera', messages: { other: '새카메라' }, flag: null }],
      })

      await compileToIosStrings('d', makeIosConfig(srcDir), transDir, {
        mergeKeys: new Set(['Camera']),
      })

      const after = i18nStringsFiles.readFileSync(stringsPath, { encoding: 'utf-8', wantsComments: true })
      assert.equal(after.NSCameraUsageDescription.text, '새카메라')
      assert.equal(after.NSMicrophoneUsageDescription.text, '기존마이크')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('removes a PR-N InfoPlist entry from base when its translation is empty', async () => {
    const dir = await makeTempDir('compile-ios-merge-')
    try {
      const srcDir = path.join(dir, 'src')
      const transDir = path.join(dir, 'trans')
      const lprojDir = path.join(srcDir, 'ko.lproj')
      await fsp.mkdir(lprojDir, { recursive: true })
      await fsp.mkdir(transDir)
      const stringsPath = path.join(lprojDir, 'InfoPlist.strings')

      await fsp.writeFile(stringsPath,
        '\n"NSCameraUsageDescription" = "기존카메라";\n' +
        '\n"NSMicrophoneUsageDescription" = "기존마이크";\n',
        { encoding: 'utf-8' },
      )

      await writeTransFiles(transDir, {
        ko: [{ context: 'NSCameraUsageDescription', key: 'Camera', messages: {}, flag: null }],
      })

      await compileToIosStrings('d', makeIosConfig(srcDir), transDir, {
        mergeKeys: new Set(['Camera']),
      })

      const after = i18nStringsFiles.readFileSync(stringsPath, { encoding: 'utf-8', wantsComments: true })
      assert.equal(after.NSCameraUsageDescription, undefined)
      assert.equal(after.NSMicrophoneUsageDescription.text, '기존마이크')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('does not touch the InfoPlist when mergeKeys is empty', async () => {
    const dir = await makeTempDir('compile-ios-merge-')
    try {
      const srcDir = path.join(dir, 'src')
      const transDir = path.join(dir, 'trans')
      const lprojDir = path.join(srcDir, 'ko.lproj')
      await fsp.mkdir(lprojDir, { recursive: true })
      await fsp.mkdir(transDir)
      const stringsPath = path.join(lprojDir, 'InfoPlist.strings')

      const original = '\n"NSCameraUsageDescription" = "기존카메라";\n'
      await fsp.writeFile(stringsPath, original, { encoding: 'utf-8' })

      await writeTransFiles(transDir, { ko: [] })

      await compileToIosStrings('d', makeIosConfig(srcDir), transDir, {
        mergeKeys: new Set(),
      })

      const after = await fsp.readFile(stringsPath, { encoding: 'utf-8' })
      assert.equal(after, original)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it('writes only PR-N keys when the InfoPlist file does not exist yet', async () => {
    const dir = await makeTempDir('compile-ios-merge-')
    try {
      const srcDir = path.join(dir, 'src')
      const transDir = path.join(dir, 'trans')
      const lprojDir = path.join(srcDir, 'ko.lproj')
      await fsp.mkdir(lprojDir, { recursive: true })
      await fsp.mkdir(transDir)
      const stringsPath = path.join(lprojDir, 'InfoPlist.strings')
      await fsp.writeFile(stringsPath, '', { encoding: 'utf-8' })

      await writeTransFiles(transDir, {
        ko: [{ context: 'NSCameraUsageDescription', key: 'Camera', messages: { other: '새카메라' }, flag: null }],
      })

      await compileToIosStrings('d', makeIosConfig(srcDir), transDir, {
        mergeKeys: new Set(['Camera']),
      })

      const after = i18nStringsFiles.readFileSync(stringsPath, { encoding: 'utf-8', wantsComments: true })
      assert.equal(after.NSCameraUsageDescription.text, '새카메라')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
