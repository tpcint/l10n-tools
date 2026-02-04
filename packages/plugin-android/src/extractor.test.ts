import { describe, it } from 'node:test'
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
      expectKeyEntry(extractor.keys, 'cdata_key_2', '<b>%1$s</b> Present.', false, 'test-file', '9')
      expectKeyEntry(extractor.keys, 'escaped_key', '<font color="#FF424D">RENEW</font>', false, 'test-file', '10')
      expectKeyEntry(extractor.keys, 'plural_key', '%d days', true, 'test-file', '11')
      expectKeyEntry(extractor.keys, 'spaced_key', 'SPACED KEY', false, 'test-file', '15')
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
})
