import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VueKeyExtractor } from './vue-key-extractor.js'

function expectKeyEntry(
  extractor: VueKeyExtractor,
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

describe('VueKeyExtractor', () => {
  describe('vue-i18n keywords in vue file', () => {
    it('extract $t in vue', () => {
      const module = `
                <template>
                    <div>
                        <span>{{ $t('Apple & Banana') }}</span>
                        <span>{{ $t('Hello') }}</span>
                    </div>
                </template>
            `
      const extractor = new VueKeyExtractor({
        markers: [{ start: '{{', end: '}}' }],
        keywords: ['$t'],
      })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'Apple & Banana', false, 'test-file', '4')
      expectKeyEntry(extractor, null, 'Hello', false, 'test-file', '5')
    })

    it('extract $t in vue (space in tag)', () => {
      const module = `
                <template>
                   <span
                        >{{ $t('Apple & Banana') }}</span>
                </template>
            `
      const extractor = new VueKeyExtractor({
        markers: [{ start: '{{', end: '}}' }],
        keywords: ['$t'],
      })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'Apple & Banana', false, 'test-file', '4')
    })

    it('extract $t in vue (space after marker)', () => {
      const module = `
                <template>
                   <span>{{
                   $t(
                   'Apple & Banana') }}</span>
                </template>
            `
      const extractor = new VueKeyExtractor({
        markers: [{ start: '{{', end: '}}' }],
        keywords: ['$t'],
      })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'Apple & Banana', false, 'test-file', '4')
    })

    it('extract $t in vue (plural)', () => {
      const module = `
                <template>
                    <div>
                        <span>{{ $t('Apple & Banana', 1) }}</span>
                        <span>{{ $t('Hello', 2) }}</span>
                    </div>
                </template>
            `
      const extractor = new VueKeyExtractor({
        markers: [{ start: '{{', end: '}}' }],
        keywords: ['$t'],
      })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'Apple & Banana', true, 'test-file', '4')
      expectKeyEntry(extractor, null, 'Hello', true, 'test-file', '5')
    })
  })

  describe('vue-i18n i18n, i18n-t tag', () => {
    it('i18n tag path and :path', () => {
      const module = `
                <template>
                    <div>
                        <i18n tag="span" path="key-vue-i18n-path"></i18n>
                        <i18n tag="span" :path="'key-vue-i18n-path-exp'"></i18n>
                        <i18n-t keypath="{name}은{br}더 이상{br}실재하지 않습니다.">
                            <template #name><img src="https://test.com/a.jpg"></template>
                            <template #br><br></template>
                        </i18n-t>
                        <i18n-t keypath="사과 {count}개" :plural="count">
                            <template #count><b>{{ count }}</b></template>
                        </i18n-t>
                    </div>
                </template>
            `
      const extractor = new VueKeyExtractor({ tagNames: ['i18n', 'i18n-t'] })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'key-vue-i18n-path', false, 'test-file', '4')
      expectKeyEntry(extractor, null, 'key-vue-i18n-path-exp', false, 'test-file', '5')
    })

    it('i18n-t tag keypath and :keypath', () => {
      const module = `
                <template>
                    <div>
                        <i18n-t keypath="{name}은{br}더 이상{br}실재하지 않습니다.">
                            <template #name><img src="https://test.com/a.jpg"></template>
                            <template #br><br></template>
                        </i18n-t>
                        <i18n-t :keypath="'사과 {count}개'" :plural="count">
                            <template #count><b>{{ count }}</b></template>
                        </i18n-t>
                    </div>
                </template>
            `
      const extractor = new VueKeyExtractor({ tagNames: ['i18n', 'i18n-t'] })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, '{name}은{br}더 이상{br}실재하지 않습니다.', false, 'test-file', '4')
      expectKeyEntry(extractor, null, '사과 {count}개', true, 'test-file', '8')
    })

    it('v-t attrs', () => {
      const module = `
                <template>
                    <div v-t="'key-v-t'"></div>
                    <div v-t="{path: 'key-v-t-path'}"></div>
                </template>
            `
      const extractor = new VueKeyExtractor({ objectAttrs: { 'v-t': ['', 'path'] } })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'key-v-t', false, 'test-file', '3')
      expectKeyEntry(extractor, null, 'key-v-t-path', false, 'test-file', '4')
    })
  })

  describe('script in vue file', () => {
    it('extract with reference', () => {
      const module = `
                <template><div></div></template>
                <script>
                class Component {
                    mounted() {
                        this.$t('key-js')
                    }
                }
                </script>
                <script lang="ts">
                class Component {
                    mounted() {
                        this.$t('key-ts')
                    }
                }
                </script>
            `
      const extractor = new VueKeyExtractor({ keywords: ['this.$t'] })
      extractor.extractVue('test-file', module)
      expectKeyEntry(extractor, null, 'key-js', false, 'test-file', '6')
      expectKeyEntry(extractor, null, 'key-ts', false, 'test-file', '13')
    })
  })
})
