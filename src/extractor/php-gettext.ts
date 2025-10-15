import fsp from 'node:fs/promises'
import log from 'npmlog'
import * as path from 'path'
import { getSrcPaths } from '../common.js'
import { KeyCollector } from '../key-collector.js'
import type { DomainConfig } from '../config.js'
import { writeKeyEntries } from '../entry.js'
import php from 'php-parser'

export default async function (domainName: string, config: DomainConfig, keysPath: string) {
  const srcPaths = await getSrcPaths(config, ['.php'])
  const keywords = new Set(config.getKeywords())
  keywords.add('_')
  keywords.add('gettext')

  const collector = new KeyCollector({
    keywords: keywords,
  })
  const extractor = new PhpExtractor(collector)
  log.info('extractKeys', 'extracting from .php files')
  for (const srcPath of srcPaths) {
    log.verbose('extractKeys', `processing '${srcPath}'`)
    const ext = path.extname(srcPath)
    if (ext === '.php') {
      const input = await fsp.readFile(srcPath, { encoding: 'utf-8' })
      extractor.extractPhpCode(srcPath, input)
    } else {
      log.warn('extractKeys', `skipping '${srcPath}': unknown extension`)
    }
  }
  await writeKeyEntries(keysPath, collector.getEntries())
}

class PhpExtractor {
  constructor(private readonly collector: KeyCollector) { }

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

  private extractPhpNode(filename: string, src: string, ast: php.Program) {
    const visit = (node: php.Node) => {
      if (node instanceof php.Call) {
        for (const { propName, position } of this.collector.keywordDefs) {
          if (node.what.kind === 'classreference') {
            if (node.what.name === propName) {
              const startOffset = src.substr(0, node.loc!.start.offset).lastIndexOf(propName)
              try {
                const keys = this.evaluatePhpArgumentValues(node.arguments[position])
                for (const key of keys) {
                  this.collector.addMessage({ filename, line: node.loc!.start.line }, key)
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
}
