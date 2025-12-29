import { glob } from 'tinyglobby'
import log from 'npmlog'
import * as path from 'path'
import fsp from 'node:fs/promises'
import { execWithLog, fileExists, getTransPath, requireBrewCmd } from './utils.js'
import {
  readKeyEntries,
  readTransEntries,
  toTransEntry,
  type TransEntry,
  type TransMessages,
  writeTransEntries,
} from './entry.js'
import type { DomainConfig, ValidationConfig } from './config.js'
import { validateMessages } from './validator.js'
import { EntryCollection } from './entry-collection.js'

/**
 * Collects source file paths from the domain configuration for the given file extensions.
 *
 * @param config - Domain configuration providing srcDirs, srcPatterns, and ignorePatterns
 * @param exts - File extensions (including the leading dot, e.g. ".ts") to match
 * @returns An array of matching source file paths
 * @throws If the domain configuration contains neither srcDirs nor srcPatterns
 */
export async function getSrcPaths(config: DomainConfig, exts: string[]): Promise<string[]> {
  const srcDirs = config.getSrcDirs()
  const srcPatterns = config.getSrcPatterns()
  const ignorePatterns = config.getIgnorePatterns()
  if (srcDirs.length === 0 && srcPatterns.length === 0) {
    throw new Error('domain config has no src-dirs nor src-patterns')
  }

  for (const srcDir of srcDirs) {
    for (const ext of exts) {
      srcPatterns.push(path.join(srcDir, '**', '*' + ext))
    }
  }

  const srcPaths: string[] = []
  for (const srcPattern of srcPatterns) {
    srcPaths.push(...await glob(srcPattern, { ignore: ignorePatterns }))
  }
  return srcPaths
}

export async function xgettext(domainName: string, language: string, keywords: string[], potPath: string, srcPaths: string[], merge: boolean) {
  await requireBrewCmd('xgettext', 'gettext', true)
  log.info('xgettext', `from ${language} source`)
  await execWithLog(
    `xgettext --language="${language}" \
            ${keywords.map(keyword => `--keyword="${keyword}"`).join(' ')} \
            --from-code=UTF-8 --no-wrap \
            ${merge ? '--join-existing' : ''} \
            --package-name="${domainName}" \
            --output="${potPath}" \
            ${srcPaths.join(' ')}`, 'xgettext')
}

export async function updateTrans(keysPath: string, fromTransDir: string, transDir: string, locales: string[], validationConfig: ValidationConfig | null) {
  await fsp.mkdir(transDir, { recursive: true })
  let baseTrans: EntryCollection<TransEntry> | null = null
  const baseLocale = validationConfig?.getBaseLocale() ?? null
  if (baseLocale != null) {
    try {
      const transEntries = await readTransEntries(getTransPath(fromTransDir, baseLocale))
      baseTrans = EntryCollection.loadEntries(transEntries)
    } catch (err) {
      log.warn('updateTrans', 'Failed to read validation base locale file', err)
    }
  }
  for (const locale of locales) {
    const fromTransPath = getTransPath(fromTransDir, locale)

    const keyTransEntries = (await readKeyEntries(keysPath)).map(entry => toTransEntry(entry))
    // const valueCollection = KeyCollection.loadEntries<ValueEntry>(keyEntries.map(e => toValueEntry(e)))
    if (await fileExists(fromTransPath)) {
      const fromTrans = EntryCollection.loadEntries<TransEntry>(await readTransEntries(fromTransPath))
      for (const keyTransEntry of keyTransEntries) {
        const fromTransEntry = fromTrans.find(keyTransEntry.context, keyTransEntry.key)
        if (fromTransEntry != null) {
          keyTransEntry.messages = { ...fromTransEntry.messages }
          if (validationConfig != null && baseLocale != locale) {
            try {
              let baseMessages: TransMessages
              if (baseTrans == null) {
                baseMessages = keyTransEntry.messages
              } else {
                const baseTransEntry = baseTrans.findByEntry(keyTransEntry)
                baseMessages = baseTransEntry?.messages ?? keyTransEntry.messages
              }
              validateMessages(baseMessages, keyTransEntry.messages)
            } catch (err: any) {
              log.warn('validation', `[${locale}] ${err.constructor.name}: ${err.message}`)
              if (keyTransEntry.context) {
                log.warn('validation', `context: \`${keyTransEntry.context}'`)
              }
              log.warn('validation', `key: \`${keyTransEntry.key}'`)
              if (!validationConfig.getSkip()) {
                throw err
              }
            }
          }
          keyTransEntry.flag = fromTransEntry.flag
        }
      }
    }

    const transPath = getTransPath(transDir, locale)
    await writeTransEntries(transPath, keyTransEntries)
  }
}