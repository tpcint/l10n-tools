import fsp from 'node:fs/promises'
import log from 'npmlog'
import * as path from 'path'
import {
  type CompileOptions,
  type CompilerConfig,
  EntryCollection,
  extractLocaleFromTransPath,
  isErrnoException,
  listTransPaths,
  readTransEntries,
  type TransEntry,
} from 'l10n-tools-core'
import {
  buildAndroidXml,
  containsAndroidXmlSpecialChars,
  createCDataNode,
  createTextNode,
  encodeAndroidStrings,
  findFirstTagNode,
  getAndroidXmlBuilder,
  getAndroidXmlParser,
  getAttrValue,
  isCDataNode,
  isTagNode,
  isTextNode,
  parseAndroidXml,
  type XMLNode,
  type XMLTagNode,
  type XMLTextNode,
} from './android-xml-utils.js'
import { getModuleName, isDefaultModule } from './extractor.js'

export async function compileToAndroidXml(
  domainName: string,
  config: CompilerConfig,
  transDir: string,
  options?: CompileOptions,
) {
  const mergeKeys = options?.mergeKeys
  if (mergeKeys != null && mergeKeys.size === 0) {
    return
  }
  const isMerge = mergeKeys != null

  const modules = config.getModules()

  if (modules.length > 0) {
    // Multi-module mode
    await compileMultiModule(modules, config, transDir, isMerge)
  } else {
    // Single res-dir mode (backward compatibility)
    await compileSingleResDir(config, transDir, isMerge)
  }
}

async function compileSingleResDir(config: CompilerConfig, transDir: string, isMerge: boolean) {
  const resDir = config.getResDir()
  const defaultLocale = config.getDefaultLocale()
  log.info('compile', `generating res files '${resDir}/values-{locale}/strings.xml'`)

  const parser = getAndroidXmlParser()
  const builder = getAndroidXmlBuilder()

  const srcXml = await readXml(resDir, null)
  const srcXmlJson = parseAndroidXml(parser, srcXml)
  const resNode = findFirstTagNode(srcXmlJson, 'resources')
  if (resNode == null) {
    throw new Error('no resources tag')
  }

  const transPaths = await listTransPaths(transDir)
  for (const transPath of transPaths) {
    const locale = extractLocaleFromTransPath(transPath)
    if (locale === defaultLocale) {
      // The default locale's xml is the source itself; in merge mode, do not rewrite it.
      if (isMerge) continue
      await writeXml(buildAndroidXml(builder, srcXmlJson), resDir, null)
    } else {
      const transEntries = await readTransEntries(transPath)
      const dstXml = await readXml(resDir, locale, '<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>')
      const newDstXml = await generateAndroidXml(locale, transEntries, srcXml, dstXml, { merge: isMerge })
      await writeXml(newDstXml, resDir, locale)
    }
  }
}

async function compileMultiModule(
  modules: string[],
  config: CompilerConfig,
  transDir: string,
  isMerge: boolean,
) {
  const defaultLocale = config.getDefaultLocale()
  const defaultModule = config.getDefaultModule()
  log.info('compile', `generating res files for ${modules.length} modules`)

  const parser = getAndroidXmlParser()
  const builder = getAndroidXmlBuilder()

  const transPaths = await listTransPaths(transDir)

  for (const module of modules) {
    const resDir = path.join(module, 'src', 'main', 'res')
    log.verbose('compile', `processing module '${module}'`)

    let srcXml: string
    try {
      srcXml = await readXml(resDir, null)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        log.warn('compile', `strings.xml not found for module: ${module}`)
        continue
      }
      throw err
    }

    const srcXmlJson = parseAndroidXml(parser, srcXml)
    const resNode = findFirstTagNode(srcXmlJson, 'resources')
    if (resNode == null) {
      log.warn('compile', `no resources tag in module: ${module}`)
      continue
    }

    for (const transPath of transPaths) {
      const locale = extractLocaleFromTransPath(transPath)
      if (locale === defaultLocale) {
        if (isMerge) continue
        await writeXml(buildAndroidXml(builder, srcXmlJson), resDir, null)
      } else {
        const transEntries = await readTransEntries(transPath)
        // Filter entries for this module
        const moduleTransEntries = filterTransEntriesForModule(transEntries, module, defaultModule)
        // In merge mode, skip module/locale combinations with no PR-scope entries —
        // otherwise an empty fallback XML would be written to a missing locale file,
        // creating a brand-new values-{locale}/strings.xml unrelated to the PR scope.
        if (isMerge && moduleTransEntries.length === 0) continue
        const dstXml = await readXml(resDir, locale, '<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>')
        const newDstXml = await generateAndroidXml(locale, moduleTransEntries, srcXml, dstXml, { merge: isMerge })
        await writeXml(newDstXml, resDir, locale)
      }
    }
  }
}

/** @internal exported for testing */
export function filterTransEntriesForModule(transEntries: TransEntry[], module: string, defaultModule?: string): TransEntry[] {
  if (isDefaultModule(module, defaultModule)) {
    // Default module entries have no prefix — filter to entries without any colon-based prefix
    return transEntries.filter(entry => entry.context != null && !entry.context.includes(':'))
  }
  const moduleName = getModuleName(module)
  const prefix = `${moduleName}:`
  return transEntries
    .filter(entry => entry.context?.startsWith(prefix))
    .map(entry => ({
      ...entry,
      // Strip module prefix from context for matching
      context: entry.context!.substring(prefix.length),
    }))
}

export interface GenerateAndroidXmlOptions {
  /**
   * When true, the output is produced by patching `dstXml` in place: only the
   * string/plurals entries that correspond to a `transEntry` are added/updated/removed,
   * and every other entry in `dstXml` (including its order) is preserved as-is.
   * When false (default), the output is rebuilt from `srcXml` as the authoritative
   * structure — every entry of dstXml is replaced.
   */
  merge?: boolean,
}

export async function generateAndroidXml(
  locale: string,
  transEntries: TransEntry[],
  srcXml: string,
  dstXml: string,
  options?: GenerateAndroidXmlOptions,
) {
  const parser = getAndroidXmlParser()
  const builder = getAndroidXmlBuilder()

  const srcXmlJson = parseAndroidXml(parser, srcXml)
  const resNode = findFirstTagNode(srcXmlJson, 'resources')
  if (resNode == null) {
    throw new Error('no resources tag')
  }

  const dstXmlJson = parseAndroidXml(parser, dstXml)
  const dstResNode = findFirstTagNode(dstXmlJson, 'resources')
  if (dstResNode == null) {
    throw new Error('no resources tag')
  }

  if (options?.merge) {
    return patchAndroidXmlMerge(transEntries, resNode, dstResNode, dstXmlJson, builder)
  }
  return rebuildAndroidXml(transEntries, resNode, dstResNode, dstXmlJson, builder)
}

function rebuildAndroidXml(
  transEntries: TransEntry[],
  srcResNode: XMLTagNode,
  dstResNode: XMLTagNode,
  dstXmlJson: ReturnType<typeof parseAndroidXml>,
  builder: ReturnType<typeof getAndroidXmlBuilder>,
): string {
  const trans = EntryCollection.loadEntries(transEntries)
  const dstResources: XMLNode[] = []
  let passingText = false
  for (const node of srcResNode.resources) {
    if (isTextNode(node)) {
      if (passingText) {
        passingText = false
      } else {
        dstResources.push(node)
      }
      continue
    }

    if (isTagNode(node, 'string')) {
      // translatable="false" 인 태그는 스킵
      const translatable = getAttrValue(node, 'translatable')
      if (translatable == 'false') {
        passingText = true
        continue
      }
      const name = getAttrValue(node, 'name')
      if (name == null) {
        passingText = true
        continue
      }
      const transEntry = trans.find(name, null)
      if (transEntry == null) {
        passingText = true
        continue
      }
      const value = transEntry.messages.other
      if (!value) {
        passingText = true
        continue
      }
      const valueNode = createValueNode(node, node.string, value)
      dstResources.push({ ...node, string: [valueNode] })
    } else if (isTagNode(node, 'plurals')) {
      const translatable = getAttrValue(node, 'translatable')
      if (translatable == 'false') {
        passingText = true
        continue
      }
      const name = getAttrValue(node, 'name')
      if (name == null) {
        passingText = true
        continue
      }
      const transEntry = trans.find(name, null)
      if (transEntry == null) {
        passingText = true
        continue
      }
      if (Object.keys(transEntry.messages).length == 0) {
        passingText = true
        continue
      }
      const pluralsNode = buildPluralsNode(node, transEntry.messages)
      if (pluralsNode == null) {
        passingText = true
        continue
      }
      dstResources.push(pluralsNode)
    } else {
      dstResources.push(node)
    }
  }

  dstResNode.resources = dstResources
  return buildAndroidXml(builder, dstXmlJson)
}

function patchAndroidXmlMerge(
  transEntries: TransEntry[],
  srcResNode: XMLTagNode,
  dstResNode: XMLTagNode,
  dstXmlJson: ReturnType<typeof parseAndroidXml>,
  builder: ReturnType<typeof getAndroidXmlBuilder>,
): string {
  const srcNodesByName = indexResourcesByName(srcResNode.resources as XMLNode[])
  const dstResources = [...dstResNode.resources as XMLNode[]]

  for (const transEntry of transEntries) {
    const name = transEntry.context
    if (name == null) continue

    const srcNode = srcNodesByName.get(name)
    if (srcNode == null) {
      // PR-scope key not found in default values — drop it from dst as well.
      removeFromResourcesByName(dstResources, name)
      continue
    }

    if (isTagNode(srcNode, 'string')) {
      const translatable = getAttrValue(srcNode, 'translatable')
      if (translatable === 'false') continue
      const value = transEntry.messages.other
      if (!value) {
        removeFromResourcesByName(dstResources, name)
        continue
      }
      const newNode = { ...srcNode, string: [createValueNode(srcNode, srcNode.string, value)] }
      replaceOrAppendByName(dstResources, name, newNode)
    } else if (isTagNode(srcNode, 'plurals')) {
      const translatable = getAttrValue(srcNode, 'translatable')
      if (translatable === 'false') continue
      if (Object.keys(transEntry.messages).length == 0) {
        removeFromResourcesByName(dstResources, name)
        continue
      }
      const pluralsNode = buildPluralsNode(srcNode, transEntry.messages)
      if (pluralsNode == null) continue
      replaceOrAppendByName(dstResources, name, pluralsNode)
    }
  }

  dstResNode.resources = dstResources
  return buildAndroidXml(builder, dstXmlJson)
}

function buildPluralsNode(srcNode: XMLTagNode, messages: TransEntry['messages']): XMLTagNode | null {
  let plFirstTextNode: XMLTextNode | null = null
  let plLastTextNode: XMLTextNode | null = null
  const plurals = srcNode.plurals
  if (isTextNode(plurals[0])) {
    plFirstTextNode = plurals[0]
  }
  if (isTextNode(plurals[plurals.length - 1])) {
    plLastTextNode = plurals[plurals.length - 1] as XMLTextNode
  }

  let itemNode = findFirstTagNode(plurals, 'item', { quantity: 'other' })
  if (itemNode == null) {
    itemNode = findFirstTagNode(plurals, 'item')
  }
  if (itemNode == null) return null

  const dstPlurals: XMLNode[] = []
  for (const [key, value] of Object.entries(messages)) {
    if (plFirstTextNode != null) {
      dstPlurals.push({ ...plFirstTextNode })
    }
    const valueNode = createValueNode(itemNode, itemNode.item, value)
    dstPlurals.push({ ...itemNode, 'item': [valueNode], ':@': { '@_quantity': key } })
  }
  if (plLastTextNode != null) {
    dstPlurals.push({ ...plLastTextNode })
  }
  return { ...srcNode, plurals: dstPlurals }
}

function indexResourcesByName(resources: XMLNode[]): Map<string, XMLTagNode> {
  const map = new Map<string, XMLTagNode>()
  for (const node of resources) {
    if (isTextNode(node)) continue
    if (!isTagNode(node, 'string') && !isTagNode(node, 'plurals')) continue
    const name = getAttrValue(node, 'name')
    if (name == null) continue
    map.set(name, node)
  }
  return map
}

function findIndexByName(resources: XMLNode[], name: string): number {
  for (let i = 0; i < resources.length; i++) {
    const node = resources[i]
    if (isTextNode(node)) continue
    if (!isTagNode(node, 'string') && !isTagNode(node, 'plurals')) continue
    if (getAttrValue(node, 'name') === name) return i
  }
  return -1
}

function replaceOrAppendByName(resources: XMLNode[], name: string, newNode: XMLTagNode): void {
  const idx = findIndexByName(resources, name)
  if (idx >= 0) {
    resources[idx] = newNode
    return
  }
  resources.push(newNode)
}

function removeFromResourcesByName(resources: XMLNode[], name: string): void {
  const idx = findIndexByName(resources, name)
  if (idx < 0) return
  // Also drop the immediately preceding text node (typically indentation/newline)
  // so we don't leave a dangling whitespace-only line where the entry was.
  if (idx > 0 && isTextNode(resources[idx - 1])) {
    resources.splice(idx - 1, 2)
  } else {
    resources.splice(idx, 1)
  }
}

function createValueNode(node: XMLTagNode, children: XMLNode[], value: string) {
  const format = getAttrValue(node, 'format')
  // html format 은 번역 텍스트 그대로 사용
  if (format === 'html') {
    return createTextNode(encodeAndroidStrings(value, true))
  } else {
    // CDATA 노드인 경우 CDATA를 그대로 살려서 스트링만 교체
    if (children.some(node => isCDataNode(node))) {
      return createCDataNode(value)
    } else if (containsAndroidXmlSpecialChars(value)) {
      return createCDataNode(encodeAndroidStrings(value, false))
    } else {
      // 그 외의 경우는 android string encoding 하여 사용
      return createTextNode(encodeAndroidStrings(value, false))
    }
  }
}

async function readXml(resDir: string, locale: string | null, fallback?: string): Promise<string> {
  let targetPath: string
  if (locale == null) {
    targetPath = path.join(resDir, 'values', 'strings.xml')
  } else {
    targetPath = path.join(resDir, 'values-' + locale, 'strings.xml')
  }

  try {
    return await fsp.readFile(targetPath, { encoding: 'utf-8' })
  } catch (err) {
    if (fallback !== undefined && isErrnoException(err, 'ENOENT')) {
      return fallback
    }
    throw err
  }
}

async function writeXml(xml: string, resDir: string, locale: string | null) {
  let targetPath: string
  if (locale == null) {
    targetPath = path.join(resDir, 'values', 'strings.xml')
  } else {
    targetPath = path.join(resDir, 'values-' + locale, 'strings.xml')
  }
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  await fsp.writeFile(targetPath, xml, { encoding: 'utf-8' })
}
