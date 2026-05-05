import fsp from 'node:fs/promises'
import { glob } from 'tinyglobby'
import log from 'npmlog'
import * as path from 'path'
import i18nStringsFiles, { type CommentedI18nStringsMsg, type I18nStringsMsg } from 'i18n-strings-files'
import PQueue from 'p-queue'
import os from 'os'
import plist from 'plist'
import {
  type CompileOptions,
  type CompilerConfig,
  EntryCollection,
  execWithLog,
  extractLocaleFromTransPath,
  fileExists,
  getTempDir,
  isErrnoException,
  listTransPaths,
  readTransEntries,
  type TransEntry,
  type TransMessages,
} from 'l10n-tools-core'

const infoPlistKeys = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSUserTrackingUsageDescription',
]

type StringsDictValue = {
  NSStringLocalizedFormatKey: '%#@format@',
  format: {
    NSStringFormatSpecTypeKey: 'NSStringPluralRuleType',
    NSStringFormatValueTypeKey: 'li',
  } & TransMessages,
}

type StringsDict = { [key: string]: StringsDictValue }

export async function compileToIosStrings(
  domainName: string,
  config: CompilerConfig,
  transDir: string,
  options?: CompileOptions,
) {
  const mergeKeys = options?.mergeKeys
  if (mergeKeys != null && mergeKeys.size === 0) {
    return
  }

  const tempDir = path.join(getTempDir(), 'compiler')
  await fsp.mkdir(tempDir, { recursive: true })
  const srcDir = config.getSrcDir()

  log.info('compile', 'generating .strings files')

  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)

    const transEntries = await readTransEntries(transPath)
    const trans = EntryCollection.loadEntries(transEntries)

    const queue = new PQueue({ concurrency: os.cpus().length })
    async function compile(stringsPath: string) {
      log.info('compile', stringsPath)
      const stringsName = path.basename(stringsPath, '.strings')
      if (stringsName === 'InfoPlist') {
        const strings: CommentedI18nStringsMsg = mergeKeys != null
          ? await readStringsIfExists(stringsPath)
          : {}
        for (const key of infoPlistKeys) {
          if (!shouldProcessKey(key, transEntries, mergeKeys)) {
            continue
          }
          const transEntry = trans.find(key, null)
          if (transEntry && transEntry.messages.other) {
            strings[key] = {
              text: transEntry.messages.other || transEntry.key,
            }
          } else if (mergeKeys == null) {
            delete strings[key]
          } else if (transEntry != null) {
            // PR-N key with no usable translation: drop from output.
            delete strings[key]
          }
        }

        const output = generateStringsFile(strings)
        await fsp.writeFile(stringsPath, output, { encoding: 'utf-8' })
      } else if (stringsName === 'Localizable') {
        await execWithLog(`find "${srcDir}" -name "*.swift" -print0 | xargs -0 genstrings -q -u -SwiftUI -o "${tempDir}"`)
        const srcStrings = i18nStringsFiles.readFileSync(path.join(tempDir, 'Localizable.strings'), { encoding: 'utf16le', wantsComments: true })
        const stringsDictPath = path.join(path.dirname(stringsPath), stringsName + '.stringsdict')

        const strings: CommentedI18nStringsMsg = mergeKeys != null
          ? await readStringsIfExists(stringsPath)
          : srcStrings
        const stringsDict: StringsDict = mergeKeys != null
          ? await readStringsDictIfExists(stringsDictPath)
          : {}

        for (const key of Object.keys(srcStrings)) {
          if (!shouldProcessKey(key, transEntries, mergeKeys)) {
            continue
          }
          const transEntry = trans.find(null, key)
          if (transEntry && transEntry.messages['other']) {
            const baseEntry = strings[key] ?? srcStrings[key]
            strings[key] = { ...baseEntry, text: transEntry.messages['other'] }
            if (Object.keys(transEntry.messages).length > 1) {
              if (!await fileExists(stringsDictPath)) {
                throw new Error(`[${locale}] Add ${stringsName}.stringsdict file to project to utilize plural translation`)
              }
              const messages = transformIosPluralMessages(locale, transEntry.key, transEntry.messages)
              stringsDict[key] = {
                NSStringLocalizedFormatKey: '%#@format@',
                format: {
                  NSStringFormatSpecTypeKey: 'NSStringPluralRuleType',
                  NSStringFormatValueTypeKey: 'li',
                  ...messages,
                },
              }
            } else {
              delete stringsDict[key]
            }
          } else if (mergeKeys == null) {
            delete strings[key]
            delete stringsDict[key]
          } else if (transEntry != null) {
            delete strings[key]
            delete stringsDict[key]
          }
        }

        const output = generateStringsFile(strings)
        const stringsDictOutput = plist.build(stringsDict)

        await fsp.writeFile(stringsPath, output, { encoding: 'utf-8' })
        await fsp.writeFile(stringsDictPath, stringsDictOutput, { encoding: 'utf-8' })
      } else {
        const basePath = path.dirname(path.dirname(stringsPath))
        for (const extName of ['.xib', '.storyboard']) {
          const xibPath = path.join(basePath, 'Base.lproj', stringsName + extName)
          if (await fileExists(xibPath)) {
            const tempStringsPath = path.join(tempDir, stringsName + '.strings')
            await execWithLog(`ibtool --export-strings-file "${tempStringsPath}" "${xibPath}"`)
            const srcStrings = i18nStringsFiles.readFileSync(tempStringsPath, { encoding: 'utf16le', wantsComments: true })

            const strings: CommentedI18nStringsMsg = mergeKeys != null
              ? await readStringsIfExists(stringsPath)
              : srcStrings

            for (const key of Object.keys(srcStrings)) {
              if (!shouldProcessKey(key, transEntries, mergeKeys)) {
                continue
              }
              const transEntry = trans.find(key, null)
              if (transEntry && transEntry.messages.other) {
                const baseEntry = strings[key] ?? srcStrings[key]
                strings[key] = { ...baseEntry, text: transEntry.messages.other || transEntry.key }
              } else if (mergeKeys == null) {
                delete strings[key]
              } else if (transEntry != null) {
                delete strings[key]
              }
            }

            const output = generateStringsFile(strings)
            await fsp.writeFile(stringsPath, output, { encoding: 'utf-8' })
            break
          }
        }
      }
    }
    const stringsPaths = await getStringsPaths(srcDir, locale)
    await queue.addAll(stringsPaths.map(stringsPath => () => compile(stringsPath)))
  }
  await fsp.rm(tempDir, { force: true, recursive: true })
}

/**
 * Whether the given strings-file `key` is in scope for processing under the current mode.
 *
 * - In full-rewrite mode (mergeKeys is null), every src-discovered key is processed.
 * - In merge mode, only keys that correspond to a PR-N trans entry are touched. We
 *   treat "key matches a trans entry by entry.context or by entry.key (when context-less)"
 *   as in-scope, so non-PR keys remain untouched in the existing output.
 *
 * @internal exported for testing
 */
export function shouldProcessKey(
  key: string,
  transEntries: TransEntry[],
  mergeKeys: Set<string> | undefined,
): boolean {
  if (mergeKeys == null) {
    return true
  }
  return transEntries.some(entry => entry.context === key || (entry.context == null && entry.key === key))
}

async function readStringsIfExists(stringsPath: string): Promise<CommentedI18nStringsMsg> {
  try {
    return i18nStringsFiles.readFileSync(stringsPath, { encoding: 'utf-8', wantsComments: true })
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return {}
    }
    // i18n-strings-files may also surface utf-8 → utf-16 mismatch as a parse error;
    // fall back to utf-16 read in that case.
    try {
      return i18nStringsFiles.readFileSync(stringsPath, { encoding: 'utf16le', wantsComments: true })
    } catch (err2) {
      if (isErrnoException(err2, 'ENOENT')) {
        return {}
      }
      throw err2
    }
  }
}

async function readStringsDictIfExists(stringsDictPath: string): Promise<StringsDict> {
  try {
    const text = await fsp.readFile(stringsDictPath, { encoding: 'utf-8' })
    const parsed = plist.parse(text) as unknown
    if (parsed != null && typeof parsed === 'object') {
      return parsed as StringsDict
    }
    return {}
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return {}
    }
    throw err
  }
}

async function getStringsPaths(srcDir: string, locale: string): Promise<string[]> {
  const srcPattern = path.join(srcDir, '**', `${locale}.lproj`, '*.strings')
  return await glob(srcPattern)
}

export function transformIosPluralMessages(locale: string, key: string, messages: TransMessages): TransMessages {
  return Object.fromEntries(
    Object.entries(messages).map(([quantity, message]) => {
      const regex = /%(1$)?l?[dDfuUi]/
      if (!regex.test(message)) {
        throw new Error(`[${locale}] "${quantity}" of "${key}": count format should be the first: "${message}"`)
      }
      return [quantity, message.replace(regex, '%li')]
    }),
  )
}

export function generateStringsFile(data: I18nStringsMsg | CommentedI18nStringsMsg) {
  let output = ''
  for (let msgid of Object.keys(data)) {
    const val = data[msgid]
    let msgstr = ''
    let comment = null
    if (typeof val === 'string') {
      msgstr = val
    } else {
      if (val.text != null) {
        msgstr = val['text']
      }
      if (val.comment != null) {
        comment = val['comment']
      }
    }
    msgid = msgid.replace(/\\/g, '\\\\')
    msgstr = msgstr.replace(/\\/g, '\\\\')
    msgid = msgid.replace(/"/g, '\\"')
    msgstr = msgstr.replace(/"/g, '\\"')
    msgid = msgid.replace(/\n/g, '\\n')
    msgstr = msgstr.replace(/\r?\n/g, '\\n')
    output = output + '\n'
    if (comment) {
      output = output + '/* ' + comment + ' */\n'
    }
    output = output + '"' + msgid + '" = "' + msgstr + '";\n'
  }
  return output
}
