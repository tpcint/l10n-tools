import { parseDocument } from 'htmlparser2'
import { isTag } from 'domhandler'
import { findAll } from 'domutils'
import {
  getElementContent,
  getElementContentIndex,
  KeyEntryBuilder,
  EntryCollection,
  type KeyEntry,
} from 'l10n-tools-core'
import log from 'npmlog'
import ts from 'typescript'
import php from 'php-parser'

export type TemplateMarker = {
  start: string,
  end: string,
  type?: 'js',
}

export type KeyExtractorOptions = {
  keywords: string[] | Set<string>,
  tagNames: string[],
  attrNames: string[],
  valueAttrNames: string[],
  objectAttrs: { [name: string]: string[] },
  filterNames: string[],
  markers: TemplateMarker[],
  exprAttrs: RegExp[],
}

type KeywordDef = {
  objectName: string | null,
  position: number,
  propName: string,
}

type KeywordArgumentPositions = {
  key: number,
  pluralCount: number | null,
}

export class KeyExtractor {
  public readonly keys: EntryCollection<KeyEntry>
  private options: KeyExtractorOptions
  private readonly keywordDefs: KeywordDef[]
  private readonly keywordMap: { [keyword: string]: KeywordArgumentPositions }

  constructor(options: Partial<KeyExtractorOptions>) {
    this.keys = new EntryCollection()
    this.options = Object.assign<KeyExtractorOptions, Partial<KeyExtractorOptions>>({
      keywords: [],
      tagNames: [],
      attrNames: [],
      valueAttrNames: [],
      objectAttrs: {},
      filterNames: [],
      markers: [],
      exprAttrs: [],
    }, options)

    this.keywordDefs = [...this.options.keywords].map(keyword => parseKeyword(keyword))
    this.keywordMap = buildKeywordMap(this.options.keywords)
  }

  private extractJsIdentifierNode(filename: string, src: string, ast: ts.SourceFile, startLine: number,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    const visit = (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
        const pos = findNonSpace(src, node.pos)
        try {
          const keys = this.evaluateTsArgumentValues(node.expression)
          for (const key of keys) {
            this.addMessage({ filename, line: getLineTo(src, pos, startLine) }, key, options)
          }
          return
        } catch (err: any) {
          log.warn('extractJsIdentifierNode', err.message)
          log.warn('extractJsIdentifierNode', `'${src.substring(pos, node.end)}': (${filename}:${getLineTo(src, pos, startLine)})`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }

  private extractJsObjectNode(filename: string, src: string, ast: ts.SourceFile, paths: string[], startLine: number = 1) {
    const visit = (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
        const pos = findNonSpace(src, node.pos)
        const errs: any[] = []
        for (const path of paths) {
          try {
            const keys = this.evaluateTsArgumentValues(node.expression, path)
            for (const key of keys) {
              this.addMessage({ filename, line: getLineTo(src, pos, startLine) }, key)
            }
            return
          } catch (err: any) {
            errs.push(err)
          }
        }
        if (errs.length > 0) {
          for (const err of errs) {
            log.warn('extractJsObjectNode', err.message)
          }
          log.warn('extractJsObjectNode', `'${src.substring(pos, node.end)}': (${filename}:${getLineTo(src, pos, startLine)})`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }

  extractJsModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractJsModule', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  extractJsxModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractJsxModule', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  extractTsxModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractTsxModule', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  extractVue(filename: string, src: string, startLine: number = 1) {
    const root = parseDocument(src, { withStartIndices: true, withEndIndices: true })
    for (const elem of root.children) {
      if (!isTag(elem)) {
        continue
      }
      if (elem.name == 'template') {
        const content = getElementContent(src, elem)
        if (content) {
          const line = getLineTo(src, getElementContentIndex(elem), startLine)
          this.extractTemplate(filename, content, line)
        }
      } else if (elem.name === 'script') {
        const content = getElementContent(src, elem)
        if (content) {
          const lang = elem.attribs['lang']
          const type = elem.attribs['type']
          if (lang === 'ts') {
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractTsModule(filename, content, line)
          } else if (!type || type === 'text/javascript') {
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractJsModule(filename, content, line)
          }
        }
      }
    }
  }

  private extractTemplate(filename: string, src: string, startLine: number = 1) {
    const root = parseDocument(src, { withStartIndices: true, withEndIndices: true })
    for (const elem of findAll(() => true, root)) {
      if (elem.name == 'script') {
        const content = getElementContent(src, elem)
        if (content) {
          const type = elem.attribs['type']
          if (!type || type == 'text/javascript') {
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractJsModule(filename, content, line)
          } else if (type === 'text/ng-template') {
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractTemplate(filename, content, line)
          }
        }
      }

      if (this.options.tagNames.includes(elem.name)) {
        if (elem.name == 'translate') {
          const content = getElementContent(src, elem)
          const key = content.trim()
          if (key) {
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            const plural = elem.attribs['translate-plural'] || null
            const comment = elem.attribs['translate-comment'] || null
            const context = elem.attribs['translate-context'] || null
            this.addMessage({ filename, line }, key, { isPlural: plural != null, comment, context })
          }
        } else if (elem.name == 'i18n') {
          if (elem.attribs['path']) {
            const key = elem.attribs['path']
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.addMessage({ filename, line }, key)
          } else if (elem.attribs[':path']) {
            const source = elem.attribs[':path']
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractJsIdentifier(filename, source, line)
          }
        } else if (elem.name == 'i18n-t') {
          if (elem.attribs['keypath']) {
            const key = elem.attribs['keypath']
            const isPlural = elem.attribs['plural'] != null || elem.attribs[':plural'] != null
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.addMessage({ filename, line }, key, { isPlural })
          } else if (elem.attribs[':keypath']) {
            const source = elem.attribs[':keypath']
            const isPlural = elem.attribs['plural'] != null || elem.attribs[':plural'] != null
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractJsIdentifier(filename, source, line, { isPlural })
          }
        }
      }

      if (this.options.attrNames.some(attrName => elem.attribs[attrName])) {
        const key = getElementContent(src, elem).trim()
        if (key) {
          const line = getLineTo(src, getElementContentIndex(elem), startLine)
          const plural = elem.attribs['translate-plural'] || null
          const comment = elem.attribs['translate-comment'] || null
          const context = elem.attribs['translate-context'] || null
          this.addMessage({ filename, line }, key, { isPlural: plural != null, comment, context })
        }
      }

      for (const [attr, content] of Object.entries(elem.attribs)) {
        if (content) {
          const startIndex = elem.startIndex!
          if (this.options.exprAttrs.some(pattern => attr.match(pattern))) {
            let contentIndex = 0
            const attrIndex = src.substring(startIndex).indexOf(attr)
            if (attrIndex >= 0) {
              contentIndex = attrIndex + attr.length
              while (/[=\s]/.test(src.substring(startIndex + contentIndex)[0])) {
                contentIndex++
              }
              if (['\'', '"'].includes(src.substring(startIndex + contentIndex)[0])) {
                contentIndex++
              }
            }
            const line = getLineTo(src, startIndex + contentIndex, startLine)
            this.extractJsExpression(filename, content, line)
          } else if (this.options.valueAttrNames.some(pattern => attr.match(pattern))) {
            let contentIndex = 0
            const attrIndex = src.substring(startIndex).indexOf(attr)
            if (attrIndex >= 0) {
              contentIndex = attrIndex + attr.length
              while (/[=\s]/.test(src.substring(startIndex + contentIndex)[0])) {
                contentIndex++
              }
              if (['\'', '"'].includes(src.substring(startIndex + contentIndex)[0])) {
                contentIndex++
              }
            }
            const line = getLineTo(src, startIndex + contentIndex, startLine)
            this.extractJsIdentifier(filename, content, line)
          } else if (Object.keys(this.options.objectAttrs).includes(attr)) {
            let contentIndex = 0
            const attrIndex = src.substring(startIndex).indexOf(attr)
            if (attrIndex >= 0) {
              contentIndex = attrIndex + attr.length
              while (/[=\s]/.test(src.substring(startIndex + contentIndex)[0])) {
                contentIndex++
              }
              if (['\'', '"'].includes(src.substring(startIndex + contentIndex)[0])) {
                contentIndex++
              }
            }
            const line = getLineTo(src, startIndex + contentIndex, startLine)
            this.extractJsObjectPaths(filename, content, this.options.objectAttrs[attr], line)
          }
        }
      }
    }

    for (const marker of this.options.markers) {
      let srcIndex = 0
      while (true) {
        let startOffset = src.indexOf(marker.start, srcIndex)
        if (startOffset === -1) {
          break
        }

        startOffset += marker.start.length
        const endOffset = src.indexOf(marker.end, startOffset)
        if (endOffset === -1) {
          srcIndex = startOffset
          continue
        }

        const content = src.substring(startOffset, endOffset)
        const line = getLineTo(src, startOffset, startLine)
        this.extractMarkerExpression(filename, content, marker, line)

        srcIndex = endOffset + marker.end.length
      }
    }
  }

  private extractMarkerExpression(filename: string, src: string, marker: TemplateMarker, startLine = 1) {
    if (!marker.type || marker.type === 'js') {
      this.extractJsExpression(filename, src, startLine)
    }
  }

  extractJsExpression(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, `(${src})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractJsExpression', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  private extractJsIdentifier(filename: string, src: string, startLine: number,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    try {
      const ast = ts.createSourceFile(filename, `(${src})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractJsIdentifierNode(filename, src, ast, startLine, options)
    } catch (err: any) {
      log.warn('extractJsIdentifier', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  private extractJsObjectPaths(filename: string, src: string, paths: string[], startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, `(${src})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractJsObjectNode(filename, src, ast, paths, startLine)
    } catch (err: any) {
      log.warn('extractJsObjectPaths', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  private evaluateTsArgumentValues(node: ts.Expression | undefined, path = ''): string[] {
    if (node == null) {
      return []
    }
    if (ts.isParenthesizedExpression(node)) {
      return this.evaluateTsArgumentValues(node.expression, path)
    }
    if (path) {
      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          if (!ts.isPropertyAssignment(prop)) {
            continue
          }
          if (!ts.isIdentifier(prop.name)) {
            continue
          }
          if (prop.name.escapedText !== path) {
            continue
          }
          return this.evaluateTsArgumentValues(prop.initializer)
        }
        throw new Error(`cannot extract translations from '${node.kind}' node, no ${path} property`)
      } else {
        throw new Error(`cannot extract translations from '${node.kind}' node, use string literal directly`)
      }
    } else {
      if (ts.isStringLiteral(node)) {
        return [node.text]
      } else if (ts.isIdentifier(node)) {
        throw new Error('cannot extract translations from variable, use string literal directly')
      } else if (ts.isPropertyAccessExpression(node)) {
        throw new Error('cannot extract translations from variable, use string literal directly')
      } else if (ts.isBinaryExpression(node) && ts.isPlusToken(node.operatorToken)) {
        const values = []
        for (const leftValue of this.evaluateTsArgumentValues(node.left)) {
          for (const rightValue of this.evaluateTsArgumentValues(node.right)) {
            values.push(leftValue + rightValue)
          }
        }
        return values
      } else if (ts.isConditionalExpression(node)) {
        return this.evaluateTsArgumentValues(node.whenTrue)
          .concat(this.evaluateTsArgumentValues(node.whenFalse))
      } else {
        throw new Error(`cannot extract translations from '${node.kind}' node, use string literal directly`)
      }
    }
  }

  private isNumericTsArgument(node: ts.Expression | undefined): boolean | null {
    if (node == null) {
      return false
    }
    if (ts.isParenthesizedExpression(node)) {
      return this.isNumericTsArgument(node.expression)
    }
    if (ts.isNumericLiteral(node)) {
      return true
    } else if (ts.isStringLiteral(node)) {
      return false
    } else if (ts.isObjectLiteralExpression(node)) {
      return false
    } else if (ts.isIdentifier(node)) {
      return null
    } else if (ts.isPropertyAccessExpression(node)) {
      return null
    } else if (ts.isBinaryExpression(node) && ts.isPlusToken(node.operatorToken)) {
      const left = this.isNumericTsArgument(node.left)
      const right = this.isNumericTsArgument(node.right)
      if (left == false || right == false) {
        return false
      }
      if (left == null || right == null) {
        return null
      }
      return true
    } else if (ts.isConditionalExpression(node)) {
      const whenTrue = this.isNumericTsArgument(node.whenTrue)
      const whenFalse = this.isNumericTsArgument(node.whenFalse)
      if (whenTrue == false || whenFalse == false) {
        return false
      }
      if (whenTrue == null || whenFalse == null) {
        return null
      }
      return true
    } else {
      throw new Error(`cannot determine '${node.kind}' is numeric`)
    }
  }

  private getTsCalleeName(node: ts.Node): string | null {
    if (ts.isIdentifier(node)) {
      return node.text
    }

    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      return 'this'
    }

    if (ts.isPropertyAccessExpression(node)) {
      const obj = this.getTsCalleeName(node.expression)
      const prop = this.getTsCalleeName(node.name)
      if (obj == null || prop == null) {
        return null
      }
      return obj + '.' + prop
    }

    return null
  }

  private extractTsNode(filename: string, src: string, ast: ts.SourceFile, startLine: number = 1) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const pos = findNonSpace(src, node.pos)
        const calleeName = this.getTsCalleeName(node.expression)
        if (calleeName != null && this.keywordMap[calleeName]) {
          try {
            const positions = this.keywordMap[calleeName]
            const keys = this.evaluateTsArgumentValues(node.arguments[positions.key])
            const isPlural = positions.pluralCount == null ? false : this.isNumericTsArgument(node.arguments[positions.pluralCount]) != false
            for (const key of keys) {
              this.addMessage({ filename, line: getLineTo(src, pos, startLine) }, key, { isPlural })
            }
          } catch (err: any) {
            log.warn('extractTsNode', err.message)
            log.warn('extractTsNode', `'${src.substring(pos, node.end)}': (${filename}:${getLineTo(src, pos, startLine)})`)
          }
        }
      } else if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'template') {
            const template = prop.initializer
            if (ts.isNoSubstitutionTemplateLiteral(template)) {
              this.extractTemplate(filename, template.text, getLineTo(src, template.pos, startLine))
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }

  extractTsModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractTsModule', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  private evaluatePhpArgumentValues(node: php.Node): string[] {
    if (node instanceof php.String) {
      return [node.value]
    } else if (node instanceof php.Encapsed) {
      throw new Error('cannot extract translations from interpolated string, use sprintf for formatting')
    } else if (node instanceof php.Variable) {
      throw new Error('cannot extract translations from variable, use string literal directly')
    } else if (node instanceof php.PropertyLookup) {
      throw new Error('cannot extract translations from variable, use string literal directly')
    } else if (node instanceof php.Bin && node.type === '+') {
      const values = []
      for (const leftValue of this.evaluatePhpArgumentValues(node.left)) {
        for (const rightValue of this.evaluatePhpArgumentValues(node.right)) {
          values.push(leftValue + rightValue)
        }
      }
      return values
    } else if (node instanceof php.RetIf) {
      return this.evaluatePhpArgumentValues(node.trueExpr)
        .concat(this.evaluatePhpArgumentValues(node.falseExpr))
    } else {
      throw new Error(`cannot extract translations from '${node.kind}' node, use string literal directly`)
    }
  }

  private extractPhpNode(filename: string, src: string, ast: php.Program) {
    const visit = (node: php.Node) => {
      if (node instanceof php.Call) {
        for (const { propName, position } of this.keywordDefs) {
          if (node.what.kind === 'classreference') {
            if (node.what.name === propName) {
              const startOffset = src.substr(0, node.loc!.start.offset).lastIndexOf(propName)
              try {
                const keys = this.evaluatePhpArgumentValues(node.arguments[position])
                for (const key of keys) {
                  this.addMessage({ filename, line: node.loc!.start.line }, key)
                }
              } catch (err: any) {
                log.warn('extractPhpNode', err.message)
                log.warn('extractPhpNode', `'${src.substring(startOffset, node.loc!.end.offset)}': (${filename}:${node.loc!.start.line})`)
              }
            }
          }
        }
      }

      for (const key in node) {
        // @ts-expect-error search all properties
        const value = node[key]
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child instanceof php.Node) {
              visit(child)
            }
          }
        } else if (value instanceof php.Node) {
          visit(value)
        }
      }
    }
    visit(ast)
  }

  extractPhpCode(filename: string, src: string) {
    const parser = new php.Engine({
      parser: {
        extractDoc: true,
        locations: true,
        php7: true,
      },
      ast: {
        withPositions: true,
      },
    })

    try {
      const ast = parser.parseCode(src, filename)
      this.extractPhpNode(filename, src, ast)
    } catch (err: any) {
      log.warn('extractPhpCode', `error parsing '${src.split(/\n/g)[err.loc.line - 1].trim()}' (${filename}:${err.loc.line})`)
    }
  }

  addMessage({ filename, line }: { filename: string, line?: string | number }, key: string,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    const { isPlural = false, comment = null, context = null } = options ?? {}
    if (context != null) {
      if (context != context.trim()) {
        throw new Error(`context has leading or trailing whitespace: "${context}"`)
      }
    }
    if (key != key.trim()) {
      throw new Error(`key has leading or trailing whitespace: "${key}"`)
    }
    const keyEntry = this.keys.find(context, key)
    const builder = keyEntry ? KeyEntryBuilder.fromKeyEntry(keyEntry) : new KeyEntryBuilder(context, key, isPlural)

    if (typeof line === 'number') {
      line = line.toString()
    }
    builder.addReference(filename, line)
    if (comment) {
      builder.addComment(comment)
    }

    this.keys.set(builder.toKeyEntry())
  }
}

function parseKeyword(keyword: string): KeywordDef {
  const [name, _pos] = keyword.split(':')
  const position = _pos ? Number.parseInt(_pos) : 0
  const [name1, name2] = name.split('.')
  if (name2) {
    return {
      objectName: name1,
      propName: name2,
      position: position,
    }
  } else {
    return {
      objectName: null,
      propName: name1,
      position: position,
    }
  }
}

function buildKeywordMap(keywords: string[] | Set<string>): { [keyword: string]: KeywordArgumentPositions } {
  const keywordMap: { [keyword: string]: KeywordArgumentPositions } = {}
  for (const keyword of keywords) {
    const [name, keyPos, pluralCountPos] = keyword.split(':')
    const key = keyPos ? Number.parseInt(keyPos) : 0
    let pluralCount: number | null
    if (keyPos != null) {
      pluralCount = pluralCountPos ? Number.parseInt(pluralCountPos) : null
    } else {
      pluralCount = key + 1
    }
    keywordMap[name] = { key, pluralCount }
  }
  return keywordMap
}

function findNonSpace(src: string, index: number): number {
  const match = /^(\s*)\S/.exec(src.substring(index))
  if (match) {
    return index + match[1].length
  } else {
    return index
  }
}

export function getLineTo(src: string, index: number, startLine: number = 1): number {
  const matches = src.substr(0, index).match(/\n/g)
  if (!matches) {
    return startLine
  }
  return startLine + matches.length
}
