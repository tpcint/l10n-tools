import log from 'npmlog'
import * as path from 'path'
import * as gettextParser from 'gettext-parser'
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser'
import fsp from 'node:fs/promises'
import {
  type CompileOptions,
  type CompilerConfig,
  extractLocaleFromTransPath,
  getPluralKeys,
  isErrnoException,
  listTransPaths,
  readTransEntries,
  type TransEntry,
} from 'l10n-tools-core'

export async function compileToPoJson(
  domainName: string,
  config: CompilerConfig,
  transDir: string,
  options?: CompileOptions,
) {
  const targetDir = config.getTargetDir()
  const mergeKeys = options?.mergeKeys

  if (mergeKeys != null && mergeKeys.size === 0) {
    return
  }

  log.info('compile', `generating json files to '${targetDir}/${domainName}/{locale}.json'`)
  await fsp.mkdir(targetDir, { recursive: true })
  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    const jsonPath = path.join(targetDir, locale + '.json')
    let po = createPo(domainName, locale, await readTransEntries(transPath))

    if (mergeKeys != null) {
      const base = await readPoJsonIfExists(jsonPath, domainName, locale)
      po = mergePoTranslations(base, po, mergeKeys)
    }

    await fsp.mkdir(targetDir, { recursive: true })
    await fsp.writeFile(jsonPath, JSON.stringify(po, null, 2))
  }
}

export async function compileToMo(
  domainName: string,
  config: CompilerConfig,
  transDir: string,
  options?: CompileOptions,
) {
  const targetDir = config.getTargetDir()
  const mergeKeys = options?.mergeKeys

  if (mergeKeys != null && mergeKeys.size === 0) {
    return
  }

  log.info('compile', `generating mo files to '${targetDir}/{locale}/LC_MESSAGES/${domainName}.mo'`)
  await fsp.mkdir(targetDir, { recursive: true })
  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    const moDir = path.join(targetDir, locale, 'LC_MESSAGES')
    const moPath = path.join(moDir, domainName + '.mo')

    let po = createPo(domainName, locale, await readTransEntries(transPath))
    if (mergeKeys != null) {
      const base = await readMoIfExists(moPath, domainName, locale)
      po = mergePoTranslations(base, po, mergeKeys)
    }
    const output = gettextParser.mo.compile(po)

    await fsp.mkdir(moDir, { recursive: true })
    await fsp.writeFile(moPath, output)
  }
}

export function createPo(domainName: string, locale: string, transEntries: TransEntry[]): GetTextTranslations {
  const po: GetTextTranslations = {
    charset: 'utf-8',
    headers: {
      'Project-Id-Version': domainName,
      'Mime-Version': '1.0',
      'Content-Type': 'text/plain; charset=UTF-8',
      'Content-Transfer-Encoding': '8bit',
      'X-Generator': 'l10n-tools',
      'Language': locale,
    },
    translations: {},
  }
  for (const transEntry of transEntries) {
    const msgctxt = transEntry.context || ''
    const msgid = transEntry.key
    if (po.translations[msgctxt] == null) {
      po.translations[msgctxt] = {}
    }
    po.translations[msgctxt][msgid] = createPoEntry(locale, transEntry)
  }
  return po
}

export function createPoEntry(locale: string, transEntry: TransEntry): GetTextTranslation {
  if (!transEntry.messages['other'] || Object.keys(transEntry.messages).length == 1) {
    return {
      msgctxt: transEntry.context || undefined,
      msgid: transEntry.key,
      msgstr: [transEntry.messages['other'] || ''],
    }
  } else {
    const msgstr: string[] = []
    for (const key of getPluralKeys(locale)) {
      msgstr.push(transEntry.messages[key] || transEntry.messages['other'] || '')
    }
    return {
      msgctxt: transEntry.context || undefined,
      msgid: transEntry.key,
      msgid_plural: transEntry.key,
      msgstr: msgstr,
    }
  }
}

/**
 * Merge `fresh` PO (built from PR-N keys) into `base` PO so that any (msgctxt, msgid)
 * with msgid in `mergeKeys` is taken from `fresh` and all other entries are preserved.
 *
 * @internal exported for testing
 */
export function mergePoTranslations(
  base: GetTextTranslations,
  fresh: GetTextTranslations,
  mergeKeys: Set<string>,
): GetTextTranslations {
  // Start with a deep-ish clone of base translations (one level enough since
  // each msgid maps to a fresh GetTextTranslation object reference we treat as immutable).
  const merged: GetTextTranslations = {
    ...base,
    headers: { ...base.headers },
    translations: {},
  }
  for (const [msgctxt, entries] of Object.entries(base.translations)) {
    merged.translations[msgctxt] = { ...entries }
  }

  // Drop all (msgctxt, msgid) where msgid is a mergeKey.
  for (const msgctxt of Object.keys(merged.translations)) {
    for (const msgid of Object.keys(merged.translations[msgctxt])) {
      if (mergeKeys.has(msgid)) {
        delete merged.translations[msgctxt][msgid]
      }
    }
    if (Object.keys(merged.translations[msgctxt]).length === 0 && msgctxt !== '') {
      delete merged.translations[msgctxt]
    }
  }

  // Add fresh entries.
  for (const [msgctxt, entries] of Object.entries(fresh.translations)) {
    if (merged.translations[msgctxt] == null) {
      merged.translations[msgctxt] = {}
    }
    for (const [msgid, entry] of Object.entries(entries)) {
      // gettext-parser uses an empty-msgid entry under the empty msgctxt for headers.
      // Always keep base headers; never let fresh's headers entry leak through.
      if (msgctxt === '' && msgid === '') {
        continue
      }
      merged.translations[msgctxt][msgid] = entry
    }
  }

  // Ensure the empty-msgid header entry under '' exists (matches createPo output shape).
  if (merged.translations[''] == null) {
    merged.translations[''] = {}
  }

  return merged
}

async function readPoJsonIfExists(
  jsonPath: string,
  domainName: string,
  locale: string,
): Promise<GetTextTranslations> {
  try {
    const text = await fsp.readFile(jsonPath, { encoding: 'utf-8' })
    const parsed = JSON.parse(text) as GetTextTranslations
    if (parsed.translations == null) {
      return emptyPo(domainName, locale)
    }
    if (parsed.headers == null) {
      parsed.headers = emptyPo(domainName, locale).headers
    }
    return parsed
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return emptyPo(domainName, locale)
    }
    throw err
  }
}

async function readMoIfExists(
  moPath: string,
  domainName: string,
  locale: string,
): Promise<GetTextTranslations> {
  try {
    const buffer = await fsp.readFile(moPath)
    const parsed = gettextParser.mo.parse(buffer) as GetTextTranslations
    if (parsed?.translations == null) {
      return emptyPo(domainName, locale)
    }
    return parsed
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return emptyPo(domainName, locale)
    }
    throw err
  }
}

function emptyPo(domainName: string, locale: string): GetTextTranslations {
  return createPo(domainName, locale, [])
}
