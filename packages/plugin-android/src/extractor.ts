import log from 'npmlog'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  type DomainConfig,
  type ExtractOptions,
  getLineTo,
  type IdKeyAttributes,
  KeyExtractor,
  type KeyMode,
  writeKeyEntries,
} from 'l10n-tools-core'
import { getElementContent, getElementContentIndex } from './element-utils.js'
import { parseDocument } from 'htmlparser2'
import { findOne } from 'domutils'
import { type Element, isTag } from 'domhandler'
import { containsAndroidXmlSpecialChars, decodeAndroidStrings } from './android-xml-utils.js'
import { decode as decodeHtmlEntities } from 'he'

/**
 * Extracts module name from module path for use in context.
 * - Strips leading ../ or ./ prefixes: ../features/auth -> features/auth
 * - Nested paths are preserved: features/auth -> features/auth
 */
export function getModuleName(modulePath: string): string {
  // Remove leading ../ or ./ prefixes
  return modulePath.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '')
}

/**
 * Check if the given module is the default module (should omit prefix in context).
 */
export function isDefaultModule(module: string, defaultModule: string | undefined): boolean {
  if (defaultModule == null) return false
  return getModuleName(module) === getModuleName(defaultModule)
}

/** 공용 키에 쓸 수 있는 문자. 모든 플랫폼의 키 형식에서 변환 없이 쓸 수 있는 문자로 제한한다 */
export const ID_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/

/** `l10n:` 속성의 접두사. 네임스페이스 URI 가 아니라 접두사로 판별한다 */
export const L10N_ATTR_PREFIX = 'l10n:'

export interface AndroidExtractOptions {
  /** 생략하면 `source` 로 동작한다 */
  keyMode?: KeyMode,
  /**
   * 공용 키 모드에서 `l10n:defaultValue` 가 없을 때 본문을 기본 문구로 읽는다. 생략하면 true.
   * 본문이 en 번역 출력으로 바뀐 뒤에는 false 로 지정해 본문을 기본 문구로 쓰지 않는다.
   */
  bodyAsDefaultValue?: boolean,
}

export async function extractAndroidKeys(domainName: string, config: DomainConfig, keysPath: string, options?: ExtractOptions) {
  const modules = config.getModules()
  const extractor = new KeyExtractor()
  const androidOptions: AndroidExtractOptions = { keyMode: options?.keyMode }

  const defaultModule = config.getDefaultModule()
  if (defaultModule != null && modules.length === 0) {
    log.warn('extractKeys', `'default-module' is set to '${defaultModule}' but 'modules' is not configured; 'default-module' will be ignored`)
  }

  if (modules.length > 0) {
    // Multi-module mode
    log.info('extractKeys', 'extracting from multiple modules')
    for (const module of modules) {
      const srcPath = path.join(module, 'src', 'main', 'res', 'values', 'strings.xml')
      log.verbose('extractKeys', `processing '${srcPath}'`)
      try {
        const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
        extractAndroidStringsXml(extractor, srcPath, input, 1, module, defaultModule, androidOptions)
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
    extractAndroidStringsXml(extractor, srcPath, input, 1, undefined, undefined, androidOptions)
  }

  await writeKeyEntries(keysPath, extractor.keys.toEntries())
}

export function extractAndroidStringsXml(
  extractor: KeyExtractor,
  filename: string,
  src: string,
  startLine: number = 1,
  module?: string,
  defaultModule?: string,
  options?: AndroidExtractOptions,
) {
  const root = parseDocument(src, { xmlMode: true, withStartIndices: true, withEndIndices: true })
  const resources = findOne(elem => elem.name == 'resources', root.children, false)
  if (resources == null) {
    return
  }
  const useIdKey = options?.keyMode === 'id'
  const bodyAsDefaultValue = options?.bodyAsDefaultValue ?? true
  // Default module omits prefix in context for backward compatibility
  const usePrefix = module != null && !isDefaultModule(module, defaultModule)
  const moduleName = module && usePrefix ? getModuleName(module) : undefined
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
      if (useIdKey) {
        const key = getIdKey(elem, filename, line)
        const idKey = getIdKeyAttributes(elem, bodyAsDefaultValue ? content : null, filename, line)
        extractor.addMessage({ filename, line }, key, { idKey })
      } else {
        const context = moduleName ? `${moduleName}:${name}` : name
        extractor.addMessage({ filename, line }, content, { context })
      }
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
      if (useIdKey) {
        const key = getIdKey(elem, filename, line)
        const idKey = getIdKeyAttributes(elem, bodyAsDefaultValue ? content : null, filename, line)
        extractor.addMessage({ filename, line }, key, { isPlural: true, idKey })
      } else {
        const context = moduleName ? `${moduleName}:${name}` : name
        extractor.addMessage({ filename, line }, content, { isPlural: true, context })
      }
    }
  }
}

/**
 * 리소스의 공용 키. `l10n:key` 가 있으면 그 값, 없으면 리소스 이름이다.
 */
export function getResourceIdKey(attribs: Record<string, string | undefined>): string | undefined {
  return attribs[`${L10N_ATTR_PREFIX}key`] ?? attribs['name']
}

function getIdKey(elem: Element, filename: string, line: number): string {
  const key = getResourceIdKey(elem.attribs)
  if (key == null || !ID_KEY_PATTERN.test(key)) {
    throw new Error(`invalid key ${JSON.stringify(key)} at ${filename}:${line}: key must match ${ID_KEY_PATTERN.source}`)
  }
  return key
}

function getIdKeyAttributes(elem: Element, body: string | null, filename: string, line: number): IdKeyAttributes {
  const draft = elem.attribs[`${L10N_ATTR_PREFIX}draft`]
  if (draft != null && draft !== 'true' && draft !== 'false') {
    throw new Error(`invalid ${L10N_ATTR_PREFIX}draft value ${JSON.stringify(draft)} at ${filename}:${line}: must be "true" or "false"`)
  }
  return {
    defaultValue: elem.attribs[`${L10N_ATTR_PREFIX}defaultValue`] ?? body,
    draft: draft === 'true',
  }
}

function getAndroidXmlStringContent(src: string, elem: Element) {
  if (elem.attribs['format'] == 'html') {
    return getElementContent(src, elem).trim()
  } else {
    let content = getElementContent(src, elem).trim()
    if (content.startsWith('<![CDATA[')) {
      content = content.substring(9, content.length - 3)
    } else {
      content = decodeAndroidStrings(content)
      if (containsAndroidXmlSpecialChars(content)) {
        content = decodeHtmlEntities(content)
      }
    }
    return content
  }
}
