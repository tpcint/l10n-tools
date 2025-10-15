import { parseDocument } from 'htmlparser2'
import { isTag } from 'domhandler'
import { findAll } from 'domutils'
import { getElementContent, getElementContentIndex } from './element-utils.js'
import log from 'npmlog'
import { getLineTo, type KeyCollector, type TemplateMarker } from '../key-collector.js'
import ts from 'typescript'

export class TsExtractor {
  constructor(private readonly collector: KeyCollector) { }

  private extractJsIdentifierNode(filename: string, src: string, ast: ts.SourceFile, startLine: number,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    const visit = (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
        const pos = findNonSpace(src, node.pos)
        try {
          const keys = this.evaluateTsArgumentValues(node.expression)
          for (const key of keys) {
            this.collector.addMessage({ filename, line: getLineTo(src, pos, startLine) }, key, options)
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
              this.collector.addMessage({ filename, line: getLineTo(src, pos, startLine) }, key)
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

      if (this.collector.options.tagNames.includes(elem.name)) {
        if (elem.name == 'translate') {
          const content = getElementContent(src, elem)
          const key = content.trim()
          if (key) {
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            const plural = elem.attribs['translate-plural'] || null
            const comment = elem.attribs['translate-comment'] || null
            const context = elem.attribs['translate-context'] || null
            this.collector.addMessage({ filename, line }, key, { isPlural: plural != null, comment, context })
          }
        } else if (elem.name == 'i18n') {
          if (elem.attribs['path']) {
            const key = elem.attribs['path']
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.collector.addMessage({ filename, line }, key)
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
            this.collector.addMessage({ filename, line }, key, { isPlural })
          } else if (elem.attribs[':keypath']) {
            const source = elem.attribs[':keypath']
            const isPlural = elem.attribs['plural'] != null || elem.attribs[':plural'] != null
            const line = getLineTo(src, getElementContentIndex(elem), startLine)
            this.extractJsIdentifier(filename, source, line, { isPlural })
          }
        }
      }

      if (this.collector.options.attrNames.some(attrName => elem.attribs[attrName])) {
        const key = getElementContent(src, elem).trim()
        if (key) {
          const line = getLineTo(src, getElementContentIndex(elem), startLine)
          const plural = elem.attribs['translate-plural'] || null
          const comment = elem.attribs['translate-comment'] || null
          const context = elem.attribs['translate-context'] || null
          this.collector.addMessage({ filename, line }, key, { isPlural: plural != null, comment, context })
        }
      }

      for (const [attr, content] of Object.entries(elem.attribs)) {
        if (content) {
          const startIndex = elem.startIndex!
          if (this.collector.options.exprAttrs.some(pattern => attr.match(pattern))) {
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
          } else if (this.collector.options.valueAttrNames.some(pattern => attr.match(pattern))) {
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
          } else if (Object.keys(this.collector.options.objectAttrs).includes(attr)) {
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
            this.extractJsObjectPaths(filename, content, this.collector.options.objectAttrs[attr], line)
          }
        }
      }
    }

    for (const marker of this.collector.options.markers) {
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
        if (calleeName != null && this.collector.keywordMap[calleeName]) {
          try {
            const positions = this.collector.keywordMap[calleeName]
            const keys = this.evaluateTsArgumentValues(node.arguments[positions.key])
            const isPlural = positions.pluralCount == null ? false : this.isNumericTsArgument(node.arguments[positions.pluralCount]) != false
            for (const key of keys) {
              this.collector.addMessage({ filename, line: getLineTo(src, pos, startLine) }, key, { isPlural })
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
}

function findNonSpace(src: string, index: number): number {
  const match = /^(\s*)\S/.exec(src.substring(index))
  if (match) {
    return index + match[1].length
  } else {
    return index
  }
}
