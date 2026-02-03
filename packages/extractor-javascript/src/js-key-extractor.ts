import { getLineTo, KeyExtractor } from 'l10n-tools-core'
import log from 'npmlog'
import * as ts from 'typescript'

export type JsKeyExtractorOptions = {
  keywords: string[] | Set<string>,
}

type KeywordArgumentPositions = {
  key: number,
  pluralCount: number | null,
}

export class JsKeyExtractor extends KeyExtractor {
  protected readonly keywordMap: { [keyword: string]: KeywordArgumentPositions }

  constructor(options: Partial<JsKeyExtractorOptions>) {
    super()
    const keywords = options.keywords ?? []
    this.keywordMap = buildKeywordMap(keywords)
  }

  extractJsModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractJsModule', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  extractJsxModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractJsxModule', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  extractTsModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractTsModule', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  extractTsxModule(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractTsxModule', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  extractJsExpression(filename: string, src: string, startLine: number = 1) {
    try {
      const ast = ts.createSourceFile(filename, `(${src})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      this.extractTsNode(filename, src, ast, startLine)
    } catch (err: any) {
      log.warn('extractJsExpression', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
  }

  protected extractTsNode(filename: string, src: string, ast: ts.SourceFile, startLine: number = 1) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        // Use getStart(ast) to skip leading trivia (comments/whitespace) for accurate line numbers
        const pos = node.getStart(ast)
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
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }

  protected evaluateTsArgumentValues(node: ts.Expression | undefined, path = ''): string[] {
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

  protected isNumericTsArgument(node: ts.Expression | undefined): boolean | null {
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

  protected getTsCalleeName(node: ts.Node): string | null {
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
