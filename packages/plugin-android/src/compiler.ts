import fsp from 'node:fs/promises'
import log from 'npmlog'
import * as path from 'path'
import {
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
import { getModuleName } from './extractor.js'

export async function compileToAndroidXml(domainName: string, config: CompilerConfig, transDir: string) {
  const modules = config.getModules()

  if (modules.length > 0) {
    // Multi-module mode
    await compileMultiModule(modules, config, transDir)
  } else {
    // Single res-dir mode (backward compatibility)
    await compileSingleResDir(config, transDir)
  }
}

async function compileSingleResDir(config: CompilerConfig, transDir: string) {
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
      await writeXml(buildAndroidXml(builder, srcXmlJson), resDir, null)
    } else {
      const transEntries = await readTransEntries(transPath)
      const dstXml = await readXml(resDir, locale, '<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>')
      const newDstXml = await generateAndroidXml(locale, transEntries, srcXml, dstXml)
      await writeXml(newDstXml, resDir, locale)
    }
  }
}

async function compileMultiModule(modules: string[], config: CompilerConfig, transDir: string) {
  const defaultLocale = config.getDefaultLocale()
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
        await writeXml(buildAndroidXml(builder, srcXmlJson), resDir, null)
      } else {
        const transEntries = await readTransEntries(transPath)
        // Filter entries for this module
        const moduleTransEntries = filterTransEntriesForModule(transEntries, module)
        const dstXml = await readXml(resDir, locale, '<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>')
        const newDstXml = await generateAndroidXml(locale, moduleTransEntries, srcXml, dstXml)
        await writeXml(newDstXml, resDir, locale)
      }
    }
  }
}

/** @internal exported for testing */
export function filterTransEntriesForModule(transEntries: TransEntry[], module: string): TransEntry[] {
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

export async function generateAndroidXml(locale: string, transEntries: TransEntry[], srcXml: string, dstXml: string) {
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

  const trans = EntryCollection.loadEntries(transEntries)

  const dstResources: XMLNode[] = []
  let passingText = false
  for (const node of resNode.resources) {
    if (isTextNode(node)) {
      if (passingText) {
        passingText = false
      } else {
        dstResources.push(node)
      }
      continue
    }

    // string 태그
    if (isTagNode(node, 'string')) {
      // translatable="false" 인 태그는 스킵
      const translatable = getAttrValue(node, 'translatable')
      if (translatable == 'false') {
        passingText = true
        continue
      }

      // name attr 없는 태그는 문제가 있는 것인데, 일단 스킵
      const name = getAttrValue(node, 'name')
      if (name == null) {
        passingText = true
        continue
      }

      // 번역이 없는 태그도 스킵
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
      // translatable="false" 인 태그는 스킵
      const translatable = getAttrValue(node, 'translatable')
      if (translatable == 'false') {
        passingText = true
        continue
      }

      // name attr 없는 태그는 문제가 있는 것인데, 일단 스킵
      const name = getAttrValue(node, 'name')
      if (name == null) {
        passingText = true
        continue
      }

      // 번역이 없는 태그도 스킵
      const transEntry = trans.find(name, null)
      if (transEntry == null) {
        passingText = true
        continue
      }
      const values = transEntry.messages
      if (Object.keys(values).length == 0) {
        passingText = true
        continue
      }

      let plFirstTextNode: XMLTextNode | null = null
      let plLastTextNode: XMLTextNode | null = null
      const plurals = (node as XMLTagNode).plurals
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
      if (itemNode == null) {
        passingText = true
        continue
      }

      const dstPlurals: XMLNode[] = []
      for (const [key, value] of Object.entries(transEntry.messages)) {
        if (plFirstTextNode != null) {
          dstPlurals.push({ ...plFirstTextNode })
        }
        const valueNode = createValueNode(itemNode, itemNode.item, value)
        dstPlurals.push({ ...itemNode, 'item': [valueNode], ':@': { '@_quantity': key } })
      }
      if (plLastTextNode != null) {
        dstPlurals.push({ ...plLastTextNode })
      }
      dstResources.push({ ...node, plurals: dstPlurals })
    } else {
      dstResources.push(node)
    }
  }

  dstResNode.resources = dstResources
  return buildAndroidXml(builder, dstXmlJson)
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
