import { KeyExtractor } from 'l10n-tools-core'
import log from 'npmlog'
import php from 'php-parser'

export type PhpKeyExtractorOptions = {
  keywords: string[] | Set<string>,
}

type KeywordDef = {
  objectName: string | null,
  position: number,
  propName: string,
}

export class PhpKeyExtractor extends KeyExtractor {
  private readonly keywordDefs: KeywordDef[]

  constructor(options: Partial<PhpKeyExtractorOptions>) {
    super()
    const keywords = options.keywords ?? []
    this.keywordDefs = [...keywords].map(keyword => parseKeyword(keyword))
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
    } else if (node instanceof php.Bin && node.type === '.') {
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
        for (const { propName, position, objectName } of this.keywordDefs) {
          let matched = false

          if (node.what.kind === 'identifier' || node.what.kind === 'name') {
            // Plain function call: _(), gettext(), etc.
            if (objectName === null && (node.what as php.Identifier).name === propName) {
              matched = true
            }
          } else if (node.what.kind === 'staticlookup' || node.what.kind === 'classreference') {
            // Static method call: Class::method()
            const what = node.what as unknown as php.StaticLookup
            if (what.what?.kind === 'name' || what.what?.kind === 'identifier') {
              const whatName = (what.what as php.Identifier).name
              const offsetName = typeof what.offset === 'object' && 'name' in what.offset ? what.offset.name : null
              if (objectName === whatName && offsetName === propName) {
                matched = true
              }
            }
            // Legacy classreference handling
            if (node.what.kind === 'classreference' && objectName === null) {
              if ((node.what as any).name === propName) {
                matched = true
              }
            }
          } else if (node.what.kind === 'propertylookup') {
            // Instance method call: $obj->method()
            const what = node.what as unknown as php.PropertyLookup
            if (what.offset?.kind === 'identifier') {
              const offsetName = (what.offset as php.Identifier).name
              if (offsetName === propName) {
                matched = true
              }
            }
          }

          if (matched) {
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
      log.warn('extractPhpCode', `error parsing '${src.split(/\n/g)[err.loc?.line - 1]?.trim() ?? ''}' (${filename}:${err.loc?.line ?? '?'})`)
    }
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
