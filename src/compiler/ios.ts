import fsp from 'node:fs/promises'
import { glob } from 'tinyglobby'
import log from 'npmlog'
import * as path from 'path'
import i18nStringsFiles, { type CommentedI18nStringsMsg, type I18nStringsMsg } from 'i18n-strings-files'
import { EntryCollection } from '../entry-collection.js'
import { readTransEntries, type TransMessages } from '../entry.js'
import { execWithLog, extractLocaleFromTransPath, fileExists, getTempDir, listTransPaths } from '../utils.js'
import type { CompilerConfig } from '../config.js'
import PQueue from 'p-queue'
import os from 'os'
import plist from 'plist'

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

export async function compileToIosStrings(domainName: string, config: CompilerConfig, transDir: string) {
  const tempDir = path.join(getTempDir(), 'compiler')
  await fsp.mkdir(tempDir, { recursive: true })
  const srcDir = config.getSrcDir()

  log.info('compile', 'generating .strings files')

  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)

    const trans = EntryCollection.loadEntries(await readTransEntries(transPath))

    const queue = new PQueue({ concurrency: os.cpus().length })
    async function compile(stringsPath: string) {
      log.info('compile', stringsPath)
      const stringsName = path.basename(stringsPath, '.strings')
      if (stringsName === 'InfoPlist') {
        const strings: CommentedI18nStringsMsg = {}
        for (const key of infoPlistKeys) {
          const transEntry = trans.find(key, null)
          if (transEntry && transEntry.messages.other) {
            strings[key] = {
              text: transEntry.messages.other || transEntry.key,
            }
          } else {
            delete strings[key]
          }
        }

        const output = generateStringsFile(strings)
        await fsp.writeFile(stringsPath, output, { encoding: 'utf-8' })
      } else if (stringsName === 'Localizable') {
        await execWithLog(`find "${srcDir}" -name "*.swift" -print0 | xargs -0 genstrings -q -u -SwiftUI -o "${tempDir}"`)
        const strings = i18nStringsFiles.readFileSync(path.join(tempDir, 'Localizable.strings'), { encoding: 'utf16le', wantsComments: true })
        const stringsDict: { [key: string]: StringsDictValue } = {}
        const stringsDictPath = path.join(path.dirname(stringsPath), stringsName + '.stringsdict')
        for (const key of Object.keys(strings)) {
          const transEntry = trans.find(null, key)
          if (transEntry && transEntry.messages['other']) {
            strings[key].text = transEntry.messages['other']
            if (Object.keys(transEntry.messages).length > 1) {
              if (!await fileExists(stringsDictPath)) {
                throw new Error(`[${locale}] Add ${stringsName}.stringsdict file to project to utilize plural translation`)
              }
              const messages = Object.fromEntries(
                Object.entries(transEntry.messages).map(([quantity, message]) => {
                  const regex = /%(1$)?l?[dDfuUi]/
                  if (!regex.test(message)) {
                    throw new Error(`[${locale}] "${quantity}" of "${transEntry.key}": count format should be the first: "${message}"`)
                  }
                  return [quantity, message.replace(regex, '%li')]
                }),
              )
              stringsDict[key] = {
                NSStringLocalizedFormatKey: '%#@format@',
                format: {
                  NSStringFormatSpecTypeKey: 'NSStringPluralRuleType',
                  NSStringFormatValueTypeKey: 'li',
                  ...messages,
                },
              }
            }
          } else {
            delete strings[key]
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
            const strings = i18nStringsFiles.readFileSync(tempStringsPath, { encoding: 'utf16le', wantsComments: true })
            for (const key of Object.keys(strings)) {
              const transEntry = trans.find(key, null)
              if (transEntry && transEntry.messages.other) {
                strings[key].text = transEntry.messages.other || transEntry.key
              } else {
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

async function getStringsPaths(srcDir: string, locale: string): Promise<string[]> {
  const srcPattern = path.join(srcDir, '**', `${locale}.lproj`, '*.strings')
  return await glob(srcPattern)
}

function generateStringsFile(data: I18nStringsMsg | CommentedI18nStringsMsg) {
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
