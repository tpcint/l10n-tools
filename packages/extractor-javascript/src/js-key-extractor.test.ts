import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JsKeyExtractor } from './js-key-extractor.js'

function expectKeyEntry(
  extractor: JsKeyExtractor,
  context: string | null,
  key: string,
  isPlural: boolean,
  file?: string,
  loc?: string,
) {
  const keyEntry = extractor.keys.find(context, key)
  assert.notEqual(keyEntry, null, `key not found: ${key}`)
  assert.equal(keyEntry!.isPlural, isPlural)
  if (file != null && loc != null) {
    assert(keyEntry!.references.some(reference => reference.file === file && reference.loc === loc))
  }
}

describe('JsKeyExtractor', () => {
  describe('vue-i18n keywords', () => {
    it('extract', () => {
      const keywords = ['$t', 'vm.$t', 'this.$t', 'app.i18n.t', '$tc', 'vm.$tc', 'this.$tc', 'app.i18n.tc']
      for (const keyword of keywords) {
        const extractor = new JsKeyExtractor({ keywords: [keyword] })
        for (const key of ['js', 'ts']) {
          const module = `
                    let $t = () => {};
                    let $tc = () => {};
                    let vm = {$t: () => {}, $tc: () => {}};
                    let app = {i18n: {$t: () => {}, $tc: () => {}}};
                    app.prototype.$t = function() {}
                    app.prototype.$tc = function() {}
                    app.prototype.test = function() {
                       ${keyword}('key-${key}');
                    }
                    `
          if (key === 'js') {
            extractor.extractJsModule('test-file', module)
            expectKeyEntry(extractor, null, 'key-js', false)
          } else if (key === 'ts') {
            extractor.extractTsModule('test-file', module)
            expectKeyEntry(extractor, null, 'key-ts', false)
          }
        }
        extractor.extractJsExpression('test-file', `${keyword}('key-jse')`)
        expectKeyEntry(extractor, null, 'key-jse', false)
      }
    })
  })

  describe('jsx file', () => {
    it('extract with reference', () => {
      const module = `
                function translate(key, options) {}
                const car = "MG Hector";

                const getDimensions = () => (
                    translate('{length}(mm) {width}(mm) {height}(mm)', {
                        length : 4655,
                        width : 1835,
                        height : 1760
                    })
                )

                export default function Vehicles() {
                    return(
                        <div>
                            <p>{car}</p>
                            <p>{getDimensions(specifications)}</p>
                        </div>
                    );
                }
            `
      const extractor = new JsKeyExtractor({ keywords: ['translate'] })
      extractor.extractJsxModule('test-file', module)
      const key = '{length}(mm) {width}(mm) {height}(mm)'
      expectKeyEntry(extractor, null, key, false, 'test-file', '6')
    })
  })
})
