import log from 'npmlog'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { type DomainConfig, getLineTo, KeyExtractor, writeKeyEntries } from 'l10n-tools-core'
import { getElementContent, getElementContentIndex } from './element-utils.js'
import { parseDocument } from 'htmlparser2'
import { findOne } from 'domutils'
import { type Element, isTag, isText } from 'domhandler'
import { containsAndroidXmlSpecialChars, decodeAndroidStrings } from './android-xml-utils.js'
import he from 'he'

/**
 * Extracts module name from module path for use in context.
 * - Strips leading ../ or ./ prefixes: ../features/auth -> features/auth
 * - Nested paths are preserved: features/auth -> features/auth
 */
export function getModuleName(modulePath: string): string {
  // Remove leading ../ or ./ prefixes
  return modulePath.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
}

export async function extractAndroidKeys(domainName: string, config: DomainConfig, keysPath: string) {
  const modules = config.getModules()
  const extractor = new KeyExtractor()

  if (modules.length > 0) {
    // Multi-module mode
    log.info('extractKeys', 'extracting from multiple modules')
    for (const module of modules) {
      const srcPath = path.join(module, 'src', 'main', 'res', 'values', 'strings.xml')
      log.verbose('extractKeys', `processing '${srcPath}'`)
      try {
        const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
        extractAndroidStringsXml(extractor, srcPath, input, 1, module)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          log.warn('extractKeys', `strings.xml not found: ${srcPath}`)
          continue
        }
        throw err
      }
    }
  } else {
    // Single res-dir mode (backward compatibility)
    const resDir = config.getResDir()
    const srcPath = path.join(resDir, 'values', 'strings.xml')
    log.info('extractKeys', 'extracting from strings.xml file')
    log.verbose('extractKeys', `processing '${srcPath}'`)
    const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
    extractAndroidStringsXml(extractor, srcPath, input)
  }

  await writeKeyEntries(keysPath, extractor.keys.toEntries())
}

export function extractAndroidStringsXml(extractor: KeyExtractor, filename: string, src: string, startLine: number = 1, module?: string) {
  const root = parseDocument(src, { xmlMode: true, withStartIndices: true, withEndIndices: true })
  const resources = findOne(elem => elem.name == 'resources', root.children, false)
  if (resources == null) {
    return
  }
  for (const elem of resources.children) {
    if (!isTag(elem)) {
      continue
    }
    if (elem.attribs['translatable'] == 'false') {
      continue
    }

    if (elem.name == 'string') {
      const name = elem.attribs['name']
      const moduleName = module ? getModuleName(module) : undefined
      const context = moduleName ? `${moduleName}:${name}` : name
      const content = getAndroidXmlStringContent(src, elem)
      const line = getLineTo(src, getElementContentIndex(elem), startLine)
      extractor.addMessage({ filename, line }, content, { context })
    } else if (elem.name == 'plurals') {
      const name = elem.attribs['name']
      const moduleName = module ? getModuleName(module) : undefined
      const context = moduleName ? `${moduleName}:${name}` : name
      const line = getLineTo(src, getElementContentIndex(elem), startLine)
      let itemElem = elem.children.filter(isTag).find(child => child.name == 'item' && child.attribs['quantity'] == 'other')
      if (itemElem == null) {
        itemElem = elem.children.filter(isTag).find(child => child.name == 'item')
      }
      if (itemElem == null) {
        log.warn('extractKeys', `missing item tag of plurals ${name}`)
        continue
      }
      const content = getAndroidXmlStringContent(src, itemElem)
      extractor.addMessage({ filename, line }, content, { isPlural: true, context })
    }
  }
}

function getAndroidXmlStringContent(src: string, elem: Element) {
  if (elem.attribs['format'] == 'html') {
    return elem.children.find(isText)?.data.trim() ?? ''
  } else {
    let content = getElementContent(src, elem).trim()
    if (content.startsWith('<![CDATA[')) {
      content = content.substring(9, content.length - 3)
    } else {
      content = decodeAndroidStrings(content)
      if (containsAndroidXmlSpecialChars(content)) {
        content = he.decode(content)
      }
    }
    return content
  }
}
