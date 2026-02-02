import log from 'npmlog'
import * as path from 'path'
import * as gettextParser from 'gettext-parser'
import type { GetTextTranslation, GetTextTranslations } from 'gettext-parser'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'url'
import {
  type CompilerConfig,
  extractLocaleFromTransPath,
  getPluralKeys,
  listTransPaths,
  readTransEntries,
  type TransEntry,
} from 'l10n-tools-core'

export async function compileToPoJson(domainName: string, config: CompilerConfig, transDir: string) {
  const targetDir = config.getTargetDir()
  log.info('compile', `generating json files to '${targetDir}/${domainName}/{locale}.json'`)
  await fsp.mkdir(targetDir, { recursive: true })
  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    const jsonPath = path.join(targetDir, locale + '.json')
    const po = await createPo(domainName, locale, await readTransEntries(transPath))

    await fsp.mkdir(targetDir, { recursive: true })
    await fsp.writeFile(jsonPath, JSON.stringify(po, null, 2))
  }
}

export async function compileToMo(domainName: string, config: CompilerConfig, transDir: string) {
  const targetDir = config.getTargetDir()
  log.info('compile', `generating mo files to '${targetDir}/{locale}/LC_MESSAGES/${domainName}.mo'`)
  await fsp.mkdir(targetDir, { recursive: true })
  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    const moDir = path.join(targetDir, locale, 'LC_MESSAGES')
    const moPath = path.join(moDir, domainName + '.mo')

    const po = await createPo(domainName, locale, await readTransEntries(transPath))
    const output = gettextParser.mo.compile(po)

    await fsp.mkdir(moDir, { recursive: true })
    await fsp.writeFile(moPath, output)
  }
}

async function createPo(domainName: string, locale: string, transEntries: TransEntry[]): Promise<GetTextTranslations> {
  const dirname = path.dirname(fileURLToPath(import.meta.url))
  let version = 'unknown'
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(dirname, '../..', 'package.json'), { encoding: 'utf-8' }))
    version = pkg.version
  } catch {
    // ignore
  }
  const po: GetTextTranslations = {
    charset: 'utf-8',
    headers: {
      'Project-Id-Version': domainName,
      'Mime-Version': '1.0',
      'Content-Type': 'text/plain; charset=UTF-8',
      'Content-Transfer-Encoding': '8bit',
      'X-Generator': `l10n-tools ${version}`,
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

function createPoEntry(locale: string, transEntry: TransEntry): GetTextTranslation {
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
