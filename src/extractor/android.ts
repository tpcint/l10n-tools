import log from 'npmlog'
import { getLineTo, KeyCollector } from '../key-collector.js'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { DomainConfig } from '../config.js'
import { writeKeyEntries } from '../entry.js'
import { parseDocument } from 'htmlparser2'
import { findOne } from 'domutils'
import { type Element, isTag, isText } from 'domhandler'
import { getElementContent, getElementContentIndex } from './element-utils.js'
import { containsAndroidXmlSpecialChars, decodeAndroidStrings } from '../compiler/android-xml-utils.js'
import he from 'he'

export default async function (domainName: string, config: DomainConfig, keysPath: string) {
  const resDir = config.getResDir()
  const srcPath = path.join(resDir, 'values', 'strings.xml')

  const collector = new KeyCollector({})
  const extractor = new AndroidExtractor(collector)
  log.info('extractKeys', 'extracting from strings.xml file')
  log.verbose('extractKeys', `processing '${srcPath}'`)
  const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
  extractor.extractAndroidStringsXml(srcPath, input)
  await writeKeyEntries(keysPath, collector.getEntries())
}

export class AndroidExtractor {
  constructor(private readonly collector: KeyCollector) { }

  extractAndroidStringsXml(filename: string, src: string, startLine: number = 1) {
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
        const content = getAndroidXmlStringContent(src, elem)
        const line = getLineTo(src, getElementContentIndex(elem), startLine)
        this.collector.addMessage({ filename, line }, content, { context: name })
      } else if (elem.name == 'plurals') {
        const name = elem.attribs['name']
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
        this.collector.addMessage({ filename, line }, content, { isPlural: true, context: name })
      }
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
