import log from 'npmlog'
import path from 'path'
import fsp from 'node:fs/promises'
import {
  type CompileOptions,
  type CompilerConfig,
  extractLocaleFromTransPath,
  getPluralKeys,
  isErrnoException,
  listTransPaths,
  outputEntryId,
  type OutputKeyReaderFunc,
  readTransEntries,
  type TransEntry,
} from 'l10n-tools-core'

export async function compileToJson(
  domainName: string,
  config: CompilerConfig,
  transDir: string,
  options?: CompileOptions,
) {
  const targetPath = config.getTargetPath()
  const mergeKeys = options?.mergeKeys

  // No keys to update: leave the existing output untouched.
  if (mergeKeys != null && mergeKeys.size === 0) {
    return
  }

  log.info('compile', `generating json file to '${targetPath}'`)

  let translations: { [locale: string]: JsonTrans } = {}
  if (mergeKeys != null) {
    translations = (await readJsonIfExists(targetPath)) as { [locale: string]: JsonTrans } | null ?? {}
  }

  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    const fresh = await exportTransToJson(locale, transPath)
    if (mergeKeys != null) {
      const base = translations[locale] ?? {}
      translations[locale] = mergeJsonTrans(base, fresh, mergeKeys)
    } else {
      translations[locale] = fresh
    }
    translations[locale] = sortJsonTrans(translations[locale])
  }
  await fsp.writeFile(targetPath, JSON.stringify(translations, null, 2) + '\n')
}

export type JsonPluralType = 'vue-i18n' | 'node-i18n' | 'i18next'

export function compileToJsonDir(pluralType?: JsonPluralType) {
  return async function (
    domainName: string,
    config: CompilerConfig,
    transDir: string,
    options?: CompileOptions,
  ) {
    const targetDir = config.getTargetDir()
    const useLocaleKey = config.useLocaleKey()
    const mergeKeys = options?.mergeKeys

    if (mergeKeys != null && mergeKeys.size === 0) {
      return
    }

    log.info('compile', `generating json files '${targetDir}/{locale}.json' (locale key: ${useLocaleKey})`)

    await fsp.mkdir(targetDir, { recursive: true })
    const transPaths = await listTransPaths(transDir)
    for (const transPath of transPaths) {
      const locale = extractLocaleFromTransPath(transPath)
      const fresh = await exportTransToJson(locale, transPath, pluralType)
      const jsonPath = path.join(targetDir, locale + '.json')
      let finalJson: JsonTrans = fresh
      if (mergeKeys != null) {
        const base = await readJsonDirBase(jsonPath, useLocaleKey, locale)
        finalJson = mergeJsonTrans(base, fresh, mergeKeys, pluralType)
      }
      finalJson = sortJsonTrans(finalJson)
      if (useLocaleKey) {
        await fsp.writeFile(jsonPath, JSON.stringify({ [locale]: finalJson }, null, 2) + '\n')
      } else {
        await fsp.writeFile(jsonPath, JSON.stringify(finalJson, null, 2) + '\n')
      }
    }
  }
}

export type JsonTransValue = string | { [transKey: string]: string }
export type JsonTrans = {
  [key: string]: JsonTransValue,
}

/**
 * Entry identities present in a single-file JSON output (`{ [locale]: { key: msg } }`),
 * unioned over `locales`. JSON outputs have no contexts, so the identity is the bare key.
 * `null` when the output file does not exist.
 */
export function readJsonOutputKeys(): OutputKeyReaderFunc {
  return async function (_domainName, config, locales) {
    const parsed = await readJsonIfExists(config.getTargetPath())
    if (parsed == null) {
      return null
    }
    const present = new Set<string>()
    const byLocale = parsed as { [locale: string]: unknown }
    for (const locale of locales) {
      const trans = byLocale[locale]
      if (trans == null || typeof trans !== 'object') {
        continue
      }
      collectJsonKeys(trans as JsonTrans, present)
    }
    return present
  }
}

/**
 * Entry identities present in a per-locale JSON output (`{locale}.json`), unioned over
 * `locales`. i18next plural suffixes are folded back to their base key so a plural entry
 * is not reported as missing. `null` when none of the locale files exist — one locale file
 * missing among others is normal, but no file at all means this output was never compiled.
 */
export function readJsonDirOutputKeys(pluralType?: JsonPluralType): OutputKeyReaderFunc {
  return async function (_domainName, config, locales) {
    const targetDir = config.getTargetDir()
    const useLocaleKey = config.useLocaleKey()
    const present = new Set<string>()
    let read = 0
    for (const locale of locales) {
      const jsonPath = path.join(targetDir, locale + '.json')
      const base = await readJsonDirIfExists(jsonPath, useLocaleKey, locale)
      if (base == null) {
        continue
      }
      read++
      collectJsonKeys(base, present, pluralType)
    }
    return read > 0 ? present : null
  }
}

function collectJsonKeys(trans: JsonTrans, into: Set<string>, pluralType?: JsonPluralType): void {
  for (const jsonKey of Object.keys(trans)) {
    into.add(outputEntryId(null, jsonKey))
    if (pluralType === 'i18next') {
      const m = jsonKey.match(I18NEXT_PLURAL_SUFFIX_RE)
      if (m) {
        into.add(outputEntryId(null, jsonKey.substring(0, m.index)))
      }
    }
  }
}

export function buildJsonTrans(locale: string, transEntries: TransEntry[], pluralType?: JsonPluralType): JsonTrans {
  const json: JsonTrans = {}
  for (const transEntry of transEntries) {
    if (transEntry.context) {
      throw new Error('[buildJsonTrans] trans entry with context is not supported yet')
    }
    if (!transEntry.key || !transEntry.messages['other']) {
      continue
    }

    if (Object.keys(transEntry.messages).length == 1) {
      json[transEntry.key] = transEntry.messages['other']
    } else if (pluralType == 'vue-i18n') {
      const messages: string[] = []
      for (const key of getPluralKeys(locale)) {
        messages.push(transEntry.messages[key] ?? transEntry.messages['other'])
      }
      json[transEntry.key] = messages.join(' | ')
    } else if (pluralType == 'node-i18n') {
      json[transEntry.key] = transEntry.messages
    } else if (pluralType == 'i18next') {
      for (const [transKey, message] of Object.entries(transEntry.messages)) {
        json[`${transEntry.key}_${transKey}`] = message
      }
    } else {
      log.warn('compile', `unsupported plural type: ${pluralType}`)
    }
  }
  return json
}

const I18NEXT_PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/

/**
 * Returns true if `jsonKey` falls within the scope of any keyName in `mergeKeys`,
 * accounting for plural-form key shapes used by each pluralType.
 *
 * @internal exported for testing
 */
export function jsonKeyMatchesMergeKeys(
  jsonKey: string,
  mergeKeys: Set<string>,
  pluralType?: JsonPluralType,
): boolean {
  if (mergeKeys.has(jsonKey)) {
    return true
  }
  if (pluralType === 'i18next') {
    const m = jsonKey.match(I18NEXT_PLURAL_SUFFIX_RE)
    if (m) {
      const base = jsonKey.substring(0, m.index)
      return mergeKeys.has(base)
    }
  }
  return false
}

/**
 * Merge `fresh` (output for PR-N keys only) into `base` (existing output) such that
 * only keys in `mergeKeys` are taken from `fresh` and all other keys are preserved.
 *
 * Both the deletion sweep on `base` and the assignment from `fresh` are gated by
 * {@link jsonKeyMatchesMergeKeys}, so an unrelated key that happens to leak into
 * `fresh` cannot overwrite `base` in merge mode.
 *
 * @internal exported for testing
 */
export function mergeJsonTrans(
  base: JsonTrans,
  fresh: JsonTrans,
  mergeKeys: Set<string>,
  pluralType?: JsonPluralType,
): JsonTrans {
  const result: JsonTrans = { ...base }
  for (const key of Object.keys(result)) {
    if (jsonKeyMatchesMergeKeys(key, mergeKeys, pluralType)) {
      delete result[key]
    }
  }
  for (const [key, value] of Object.entries(fresh)) {
    if (!jsonKeyMatchesMergeKeys(key, mergeKeys, pluralType)) {
      continue
    }
    result[key] = value
  }
  return result
}

/**
 * Returns a copy of `trans` with keys reinserted in alphabetical order so the
 * compiled output is deterministic regardless of how merge mode shuffled the
 * underlying object.
 *
 * @internal exported for testing
 */
export function sortJsonTrans(trans: JsonTrans): JsonTrans {
  const sorted: JsonTrans = {}
  for (const key of Object.keys(trans).sort()) {
    sorted[key] = trans[key]
  }
  return sorted
}

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    const text = await fsp.readFile(filePath, { encoding: 'utf-8' })
    return JSON.parse(text)
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return null
    }
    throw err
  }
}

async function readJsonDirBase(jsonPath: string, useLocaleKey: boolean, locale: string): Promise<JsonTrans> {
  return (await readJsonDirIfExists(jsonPath, useLocaleKey, locale)) ?? {}
}

async function readJsonDirIfExists(
  jsonPath: string,
  useLocaleKey: boolean,
  locale: string,
): Promise<JsonTrans | null> {
  const parsed = await readJsonIfExists(jsonPath)
  if (parsed == null) {
    return null
  }
  if (useLocaleKey) {
    const inner = (parsed as { [locale: string]: unknown })[locale]
    if (inner == null || typeof inner !== 'object') {
      return {}
    }
    return inner as JsonTrans
  }
  return parsed as JsonTrans
}

async function exportTransToJson(locale: string, transPath: string, pluralType?: JsonPluralType): Promise<JsonTrans> {
  const transEntries = await readTransEntries(transPath)
  return buildJsonTrans(locale, transEntries, pluralType)
}
