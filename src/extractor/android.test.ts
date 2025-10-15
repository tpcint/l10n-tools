import { describe, it } from 'node:test'
import { KeyCollector } from '../key-collector.js'
import { AndroidExtractor } from './android.js'
import { expectKeyEntry } from '../test/utils.js'

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
      const collector = new KeyCollector({})
      const extractor = new AndroidExtractor(collector)
      extractor.extractAndroidStringsXml('test-file', srcXml)
      expectKeyEntry(collector.keys, 'normal_key', 'LIKEY', false, 'test-file', '3')
      expectKeyEntry(collector.keys, 'html_key_1', 'No Account? <font color="#FF424D">SignUp</font>', false, 'test-file', '4')
      expectKeyEntry(collector.keys, 'html_key_2', 'Agreed to <u>Terms</u> and <u>PP</u>', false, 'test-file', '5')
      expectKeyEntry(collector.keys, 'cdata_key_1', '관심사 & 해시태그', false, 'test-file', '6')
      expectKeyEntry(collector.keys, 'html_key_3', '<b>관심사!</b>\\n설정!\\n아래!', false, 'test-file', '7')
      expectKeyEntry(collector.keys, 'cdata_key_2', '<b>%1$s</b> Present.', false, 'test-file', '9')
      expectKeyEntry(collector.keys, 'escaped_key', '<font color="#FF424D">RENEW</font>', false, 'test-file', '10')
      expectKeyEntry(collector.keys, 'plural_key', '%d days', true, 'test-file', '11')
      expectKeyEntry(collector.keys, 'spaced_key', 'SPACED KEY', false, 'test-file', '15')
    })
  })
})
