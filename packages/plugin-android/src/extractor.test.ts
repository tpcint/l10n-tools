import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { KeyExtractor } from 'l10n-tools-core'
import { extractAndroidStringsXml } from './extractor.js'
import { expectKeyEntry } from './test-utils.js'

describe('android extractor test', () => {
  describe('android strings.xml', () => {
    it('extract with reference', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="normal_key">LIKEY</string>
    <string name="html_key_1" format="html">No Account? <font color="#FF424D">SignUp</font></string>
    <string name="html_key_2" format="html">Agreed to <u>Terms</u> and <u>PP</u></string>
    <string name="cdata_key_1"><![CDATA[관심사 & 해시태그]]></string>
    <string name="html_key_3" format="html"><b>관심사!</b>\\n설정!\\n아래!</string>
    <string name="html_key_4" format="html"><u>상세보기</u></string>
    <string name="no_trans_key" translatable="false">(+%1$s)</string>
    <string name="cdata_key_2"><![CDATA[<b>%1$s</b> Present.]]></string>
    <string name="escaped_key">&lt;font color="#FF424D"&gt;RENEW&lt;/font&gt;</string>
    <plurals name="plural_key">
        <item quantity="one">%d day</item>
        <item quantity="other">%d days</item>
    </plurals>
    <string name="spaced_key">SPACED KEY </string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml)
      expectKeyEntry(extractor.keys, 'normal_key', 'LIKEY', false, 'test-file', '3')
      expectKeyEntry(extractor.keys, 'html_key_1', 'No Account? <font color="#FF424D">SignUp</font>', false, 'test-file', '4')
      expectKeyEntry(extractor.keys, 'html_key_2', 'Agreed to <u>Terms</u> and <u>PP</u>', false, 'test-file', '5')
      expectKeyEntry(extractor.keys, 'cdata_key_1', '관심사 & 해시태그', false, 'test-file', '6')
      expectKeyEntry(extractor.keys, 'html_key_3', '<b>관심사!</b>\\n설정!\\n아래!', false, 'test-file', '7')
      // html format with only tag children (no leading text node) must not produce empty key
      expectKeyEntry(extractor.keys, 'html_key_4', '<u>상세보기</u>', false, 'test-file', '8')
      expectKeyEntry(extractor.keys, 'cdata_key_2', '<b>%1$s</b> Present.', false, 'test-file', '10')
      expectKeyEntry(extractor.keys, 'escaped_key', '<font color="#FF424D">RENEW</font>', false, 'test-file', '11')
      expectKeyEntry(extractor.keys, 'plural_key', '%d days', true, 'test-file', '12')
      expectKeyEntry(extractor.keys, 'spaced_key', 'SPACED KEY', false, 'test-file', '16')
    })
  })

  describe('multi-module support', () => {
    it('extracts with module prefix in context', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp</string>
    <string name="login_button">Login</string>
    <plurals name="items_count">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'app/src/main/res/values/strings.xml', srcXml, 1, 'app')

      // context should be module:name format
      expectKeyEntry(extractor.keys, 'app:app_name', 'MyApp', false)
      expectKeyEntry(extractor.keys, 'app:login_button', 'Login', false)
      expectKeyEntry(extractor.keys, 'app:items_count', '%d items', true)
    })

    it('extracts with nested module path preserving full path', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="auth_title">Authentication</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'features/auth/src/main/res/values/strings.xml', srcXml, 1, 'features/auth')

      // nested paths are preserved as-is
      expectKeyEntry(extractor.keys, 'features/auth:auth_title', 'Authentication', false)
    })

    it('extracts with relative module path stripping ../ prefix', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, '../app/src/main/res/values/strings.xml', srcXml, 1, '../app')

      // ../app -> app
      expectKeyEntry(extractor.keys, 'app:app_name', 'MyApp', false)
    })

    it('extracts with nested relative module path preserving structure', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="auth_title">Authentication</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, '../features/auth/src/main/res/values/strings.xml', srcXml, 1, '../features/auth')

      // ../features/auth -> features/auth
      expectKeyEntry(extractor.keys, 'features/auth:auth_title', 'Authentication', false)
    })

    it('extracts without prefix for default module', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp</string>
    <plurals name="items_count">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'app/src/main/res/values/strings.xml', srcXml, 1, 'app', 'app')

      // default module should have no prefix
      expectKeyEntry(extractor.keys, 'app_name', 'MyApp', false)
      expectKeyEntry(extractor.keys, 'items_count', '%d items', true)
    })

    it('extracts without prefix for default module with relative path', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, '../app/src/main/res/values/strings.xml', srcXml, 1, '../app', 'app')

      // ../app matches default module "app" after normalization
      expectKeyEntry(extractor.keys, 'app_name', 'MyApp', false)
    })

    it('still adds prefix for non-default modules when default-module is set', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="auth_title">Authentication</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'features/auth/src/main/res/values/strings.xml', srcXml, 1, 'features/auth', 'app')

      // non-default module still gets prefix
      expectKeyEntry(extractor.keys, 'features/auth:auth_title', 'Authentication', false)
    })

    it('extracts without module prefix when module is not specified', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="simple_key">Simple Value</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml)

      // context should be just the name (no module prefix)
      expectKeyEntry(extractor.keys, 'simple_key', 'Simple Value', false)
    })
  })

  describe('id key mode', () => {
    const L10N_NS = 'xmlns:l10n="http://github.com/tpcint/l10n-tools"'

    it('uses resource name as key and body as default value', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="publish_button">공개</string>
    <string name="html_key" format="html"><b>%1$s</b>님</string>
    <string name="no_trans_key" translatable="false">(+%1$s)</string>
    <plurals name="left_days">
        <item quantity="other">%d일</item>
    </plurals>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'app/strings.xml', srcXml, 1, 'app', undefined, { keyMode: 'id' })
      const entries = extractor.keys.toEntries()
      assert.deepEqual(entries.map(entry => entry.key).sort(), ['html_key', 'left_days', 'publish_button'])
      assert.ok(entries.every(entry => entry.context == null))
      const publish = extractor.keys.find(null, 'publish_button')!
      assert.deepEqual(publish.idKey, { defaultValue: '공개', draft: false })
      assert.deepEqual(publish.references, [{ file: 'app/strings.xml', loc: '3' }])
      assert.deepEqual(extractor.keys.find(null, 'html_key')!.idKey, { defaultValue: '<b>%1$s</b>님', draft: false })
      const plural = extractor.keys.find(null, 'left_days')!
      assert.equal(plural.isPlural, true)
      assert.deepEqual(plural.idKey, { defaultValue: '%d일', draft: false })
    })

    it('reads l10n:key, l10n:defaultValue and l10n:draft', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="publish_cta" l10n:key="publish_button" l10n:defaultValue="공개">Publish</string>
    <string name="policy" l10n:defaultValue="무슨무슨 정책" l10n:draft="true">무슨무슨 정책</string>
    <string name="not_draft" l10n:draft="false">확인</string>
    <string name="entity" l10n:defaultValue="&lt;b&gt;굵게&lt;/b&gt;">Bold</string>
    <plurals name="left_days" l10n:defaultValue="%d일 남음">
        <item quantity="one">%d day left</item>
        <item quantity="other">%d days left</item>
    </plurals>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id' })
      assert.equal(extractor.keys.find(null, 'publish_cta'), null)
      assert.deepEqual(extractor.keys.find(null, 'publish_button')!.idKey, { defaultValue: '공개', draft: false })
      assert.deepEqual(extractor.keys.find(null, 'policy')!.idKey, { defaultValue: '무슨무슨 정책', draft: true })
      assert.deepEqual(extractor.keys.find(null, 'not_draft')!.idKey, { defaultValue: '확인', draft: false })
      assert.deepEqual(extractor.keys.find(null, 'entity')!.idKey, { defaultValue: '<b>굵게</b>', draft: false })
      assert.deepEqual(extractor.keys.find(null, 'left_days')!.idKey, { defaultValue: '%d일 남음', draft: false })
    })

    it('reads l10n:defaultValue of an html resource in the same form as its body', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="from_body" format="html"><b>AT&amp;T</b></string>
    <string name="from_attr" format="html" l10n:defaultValue="&lt;b&gt;AT&amp;amp;T&lt;/b&gt;">AT&amp;T</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id' })
      assert.equal(extractor.keys.find(null, 'from_body')!.idKey!.defaultValue, '<b>AT&amp;T</b>')
      assert.equal(extractor.keys.find(null, 'from_attr')!.idKey!.defaultValue, '<b>AT&amp;T</b>')
    })

    it('does not read body as default value when bodyAsDefaultValue is false', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="publish_button" l10n:defaultValue="공개">Publish</string>
    <string name="registered">Registered</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id', bodyAsDefaultValue: false })
      assert.deepEqual(extractor.keys.find(null, 'publish_button')!.idKey, { defaultValue: '공개', draft: false })
      assert.deepEqual(extractor.keys.find(null, 'registered')!.idKey, { defaultValue: null, draft: false })
    })

    it('does not decode the body when it is not used as the default value', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="with_default" l10n:defaultValue="경로">C:\\users</string>
    <string name="registered">C:\\users</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id', bodyAsDefaultValue: false })
      assert.deepEqual(extractor.keys.find(null, 'with_default')!.idKey, { defaultValue: '경로', draft: false })
      assert.deepEqual(extractor.keys.find(null, 'registered')!.idKey, { defaultValue: null, draft: false })
    })

    it('throws when the resource name does not match the key pattern', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="auth.login.title">로그인</string>
</resources>`
      const extractor = new KeyExtractor()
      assert.throws(
        () => extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id' }),
        /invalid key "auth\.login\.title" at test-file:3/,
      )
    })

    it('throws when l10n:key does not match the key pattern', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="publish_cta" l10n:key="1publish">공개</string>
</resources>`
      const extractor = new KeyExtractor()
      assert.throws(
        () => extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id' }),
        /invalid key "1publish" at test-file:3/,
      )
    })

    it('throws when l10n:draft is neither true nor false', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="policy" l10n:draft="yes">정책</string>
</resources>`
      const extractor = new KeyExtractor()
      assert.throws(
        () => extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, undefined, undefined, { keyMode: 'id' }),
        /invalid l10n:draft value "yes" at test-file:3/,
      )
    })

    it('merges the same key in multiple modules when default values are the same', () => {
      const appXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="live_cast_chat_deleted_by_admin">관리자가 삭제한 메시지입니다.</string>
</resources>`
      const presentationXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="other_key">다른 문구</string>
    <string name="live_cast_chat_deleted_by_admin">관리자가 삭제한 메시지입니다.</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'app/strings.xml', appXml, 1, 'app', 'app', { keyMode: 'id' })
      extractAndroidStringsXml(extractor, 'presentation/strings.xml', presentationXml, 1, 'presentation', 'app', { keyMode: 'id' })
      const entry = extractor.keys.find(null, 'live_cast_chat_deleted_by_admin')!
      assert.deepEqual(entry.idKey, { defaultValue: '관리자가 삭제한 메시지입니다.', draft: false })
      assert.deepEqual(entry.references, [
        { file: 'app/strings.xml', loc: '3' },
        { file: 'presentation/strings.xml', loc: '4' },
      ])
      assert.equal(extractor.keys.toEntries().length, 2)
    })

    it('throws when the same key in multiple modules has different default values', () => {
      const appXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="confirm">확인</string>
</resources>`
      const presentationXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="confirm">확인하기</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'app/strings.xml', appXml, 1, 'app', undefined, { keyMode: 'id' })
      assert.throws(
        () => extractAndroidStringsXml(extractor, 'presentation/strings.xml', presentationXml, 1, 'presentation', undefined, { keyMode: 'id' }),
        /conflicting key "confirm" at presentation\/strings\.xml:3/,
      )
    })

    it('ignores l10n: attributes in source key mode', () => {
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources ${L10N_NS}>
    <string name="publish_cta" l10n:key="publish_button" l10n:defaultValue="공개" l10n:draft="true">Publish</string>
</resources>`
      const extractor = new KeyExtractor()
      extractAndroidStringsXml(extractor, 'test-file', srcXml, 1, 'app', undefined)
      expectKeyEntry(extractor.keys, 'app:publish_cta', 'Publish', false, 'test-file', '3')
      assert.equal(extractor.keys.find('app:publish_cta', null)!.idKey, undefined)
    })
  })
})
