import fsp from 'node:fs/promises'
import { extractLocaleFromTransPath, getTransPath, listTransPaths } from './utils.js'

export type KeyReference = {
  file: string,
  loc?: string,
}

export function compareKeyReference(a: KeyReference, b: KeyReference) {
  if (a.file == b.file) {
    if (b.loc == null) {
      return 1
    } else if (a.loc == null) {
      return -1
    } else {
      return a.loc > b.loc ? 1 : -1
    }
  } else {
    return a.file > b.file ? 1 : -1
  }
}

export type BaseEntry = {
  context: string | null,
  key: string,
}

export type KeyEntry = BaseEntry & {
  isPlural: boolean,
  references: KeyReference[],
  comments: string[],
}

export type TransPluralKey = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
export type TransMessages = Partial<Record<TransPluralKey, string>>

export type TransEntry = BaseEntry & {
  messages: TransMessages,
  flag: string | null,
}

export function toTransEntry(entry: KeyEntry): TransEntry {
  return {
    context: entry.context,
    key: entry.key,
    messages: {},
    flag: null,
  }
}

export function compareEntry(a: BaseEntry, b: BaseEntry) {
  if (a.context == null && b.context == null) {
    if (a.key == b.key) {
      return 0
    } else {
      return a.key > b.key ? 1 : -1
    }
  } else if (b.context == null) {
    return 1
  } else if (a.context == null) {
    return -1
  } else if (a.context == b.context) {
    return 0
  } else {
    return a.context > b.context ? 1 : -1
  }
}

export async function readKeyEntries(file: string): Promise<KeyEntry[]> {
  const input = await fsp.readFile(file, { encoding: 'utf-8' })
  const { keys: entries } = JSON.parse(input)
  return entries.map((entry: any) => {
    return {
      context: entry.context || null,
      key: entry.key || '',
      isPlural: entry.isPlural || false,
      references: entry.references || [],
      comments: entry.comments || [],
    }
  })
}

export async function readTransEntries(file: string): Promise<TransEntry[]> {
  const input = await fsp.readFile(file, { encoding: 'utf-8' })
  const { translations: entries } = JSON.parse(input) as { translations: TransEntry[] }
  return entries.map((entry: any) => {
    return {
      context: entry.context || null,
      key: entry.key || '',
      messages: entry.messages || {},
      flag: entry.flag || null,
    }
  })
}

export async function readAllTransEntries(transDir: string): Promise<{ [locale: string]: TransEntry[] }> {
  const transPaths = await listTransPaths(transDir)

  const allTransEntries: { [locale: string]: TransEntry[] } = {}
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    allTransEntries[locale] = await readTransEntries(transPath)
  }
  // console.log('po data read', JSON.stringify(poData, null, 2))
  return allTransEntries
}

export async function writeKeyEntries(file: string, entries: KeyEntry[]) {
  entries.sort(compareEntry)
  const output = JSON.stringify({
    count: entries.length,
    keys: entries,
  }, null, 2)
  await fsp.writeFile(file, output, { encoding: 'utf-8' })
}

export async function writeTransEntries(file: string, entries: TransEntry[]) {
  entries.sort(compareEntry)
  const output = JSON.stringify({
    count: entries.length,
    translations: entries,
  }, null, 2)
  await fsp.writeFile(file, output, { encoding: 'utf-8' })
}

export async function writeAllTransEntries(transDir: string, allTransEntries: { [locale: string]: TransEntry[] }) {
  // console.log('po data to write', JSON.stringify(poData, null, 2))
  for (const [locale, transEntries] of Object.entries(allTransEntries)) {
    const transPath = getTransPath(transDir, locale)
    await writeTransEntries(transPath, transEntries)
  }
}

export function checkTransEntrySpecs(transEntry: TransEntry, specs: string[], useUnverified: boolean): boolean {
  return specs.every(spec => {
    const positive = !spec.startsWith('!')
    if (!positive) {
      spec = spec.substr(1)
    }
    const isVerified = useUnverified || transEntry.flag !== 'unverified'

    if (spec === 'total') {
      return positive
    } else if (spec === 'untranslated') {
      if (transEntry.messages.other && isVerified) {
        return !positive
      } else {
        return positive
      }
    } else if (spec === 'translated') {
      if (transEntry.messages.other && isVerified) {
        return positive
      } else {
        return !positive
      }
    } else {
      if (spec === transEntry.flag) {
        return positive
      } else {
        return !positive
      }
    }
  })
}

export function getPluralKeys(locale: string): TransPluralKey[] {
  const otherOnly: TransPluralKey[] = ['other']
  const oneOther: TransPluralKey[] = ['one', 'other']
  const oneFewManyOther: TransPluralKey[] = ['one', 'few', 'many', 'other']
  const pluralMap: { [locale: string]: TransPluralKey[] } = {
    ko: otherOnly,
    cn: otherOnly,
    en: oneOther,
    fr: oneOther,
    id: otherOnly,
    ja: otherOnly,
    ru: oneFewManyOther,
    es: oneOther,
    th: otherOnly,
  }
  const pluralKeys = pluralMap[locale.substring(0, 2)]
  if (pluralKeys == null) {
    throw new Error(`plural keys for ${locale} not supported`)
  }
  return pluralKeys
}
