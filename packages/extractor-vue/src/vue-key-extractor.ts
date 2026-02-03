import { parseDocument } from 'htmlparser2'
import { isTag } from 'domhandler'
import { findAll } from 'domutils'
import { getElementContent, getElementContentIndex } from './element-utils.js'
import { getLineTo, JsKeyExtractor } from 'l10n-tools-extractor-javascript'
import log from 'npmlog'
import * as ts from 'typescript'

export type TemplateMarker = {
  start: string,
  end: string,
  type?: 'js',
}

export type VueKeyExtractorOptions = {
  keywords: string[] | Set<string>,
  tagNames: string[],
  attrNames: string[],
  valueAttrNames: string[],
  objectAttrs: { [name: string]: string[] },
  markers: TemplateMarker[],
  exprAttrs: RegExp[],
}

export class VueKeyExtractor extends JsKeyExtractor {
  private vueOptions: VueKeyExtractorOptions

  constructor(options: Partial<VueKeyExtractorOptions>) {
    super({ keywords: options.keywords })
    this.vueOptions = Object.assign<VueKeyExtractorOptions, Partial<VueKeyExtractorOptions>>({
      keywords: [],
      tagNames: [],
      attrNames: [],
      valueAttrNames: [],
      objectAttrs: {},
      markers: [],
      exprAttrs: [],
    }, options)
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

  protected extractTsNode(filename: string, src: string, ast: ts.SourceFile, startLine: number = 1) {
    // Call parent's implementation for keyword handling
    super.extractTsNode(filename, src, ast, startLine)

    // Add Vue-specific: look for template property in object literals
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
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

  private extractTemplate(filename: string, src: string, startLine: number = 1) {
    const root = parseDocument(src, { withStartIndices: true, withEndIndices: true })
    for (const elem of findAll(() => true, root)) {
      // Handle <script> tags within templates
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

      // Handle Vue-specific tags (translate, i18n, i18n-t)
      if (this.vueOptions.tagNames.includes(elem.name)) {
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

      // Handle v-translate directive
      if (this.vueOptions.attrNames.some(attrName => elem.attribs[attrName])) {
        const key = getElementContent(src, elem).trim()
        if (key) {
          const line = getLineTo(src, getElementContentIndex(elem), startLine)
          const plural = elem.attribs['translate-plural'] || null
          const comment = elem.attribs['translate-comment'] || null
          const context = elem.attribs['translate-context'] || null
          this.addMessage({ filename, line }, key, { isPlural: plural != null, comment, context })
        }
      }

      // Handle Vue binding attributes
      for (const [attr, content] of Object.entries(elem.attribs)) {
        if (content) {
          const startIndex = elem.startIndex!
          if (this.vueOptions.exprAttrs.some(pattern => attr.match(pattern))) {
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
          } else if (this.vueOptions.valueAttrNames?.some(pattern => attr.match(pattern))) {
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
          } else if (Object.keys(this.vueOptions.objectAttrs).includes(attr)) {
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
            this.extractJsObjectPaths(filename, content, this.vueOptions.objectAttrs[attr], line)
          }
        }
      }
    }

    // Handle marker expressions ({{ }})
    for (const marker of this.vueOptions.markers) {
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
        if (!marker.type || marker.type === 'js') {
          this.extractJsExpression(filename, content, line)
        }

        srcIndex = endOffset + marker.end.length
      }
    }
  }

  private extractJsIdentifier(filename: string, src: string, startLine: number,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    try {
      const ast = ts.createSourceFile(filename, `(${src})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractJsIdentifierNode(filename, src, ast, startLine, options)
    } catch (err: any) {
      log.warn('extractJsIdentifier', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  private extractJsIdentifierNode(filename: string, src: string, ast: ts.SourceFile, startLine: number,
    options?: { isPlural?: boolean, comment?: string | null, context?: string | null }) {
    const visit = (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
        const pos = node.getStart(ast)
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

  private extractJsObjectPaths(filename: string, src: string, paths: string[], startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, `(${src})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractJsObjectNode(filename, src, ast, paths, startLine)
    } catch (err: any) {
      log.warn('extractJsObjectPaths', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  private extractJsObjectNode(filename: string, src: string, ast: ts.SourceFile, paths: string[], startLine: number = 1) {
    const visit = (node: ts.Node) => {
      if (ts.isExpressionStatement(node)) {
        const pos = node.getStart(ast)
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
}
