import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TransEntry } from 'l10n-tools-core'
import { filterTransEntriesForModule, generateAndroidXml } from './compiler.js'

describe('android compiler test', () => {
  it('parse and build preserving all', async () => {
    const transEntries: TransEntry[] = [
      {
        context: 'sign_up_ask_comment_v2',
        key: '아직 계정이 없으신가요? <font color="#FF424D">회원가입</font>',
        messages: { other: 'Don\'t have an account? <font color="#FF424D">Sign up</font>' },
        flag: null,
      },
      {
        context: 'sign_up_form_policy_agreement_desc_v2',
        key: '<u>서비스 이용약관</u>과 <u>개인정보 처리방침</u>에 동의합니다.',
        messages: { other: '<u>서비스 이용약관</u>과 <u>개인정보 처리방침</u>에 동의합니다.' },
        flag: null,
      },
      {
        context: 'user_interest_form_title',
        key: '관심사 & 해시태그',
        messages: { other: '관심사 & 해시태그' },
        flag: null,
      },
      {
        context: 'user_interest_edit_req_desc_for_fan',
        key: '<b>관심사 선택 기능이 새로 나왔습니다!</b>\\n관심사를 설정하시면 나와 맞는 크리에이터들을 추천해드릴께요!\\n아래에서 최소 3개 이상을 선택해주세요!',
        messages: { other: '<b>관심사 선택 기능이 새로 나왔습니다!</b>\\n관심사를 설정하시면 나와 맞는 크리에이터들을 추천해드릴께요!\\n아래에서 최소 3개 이상을 선택해주세요!' },
        flag: null,
      },
      {
        context: 'alarm_list_item_desc_gift_dm_received',
        key: '<b>%1$s</b>님이 선물을 보냈습니다.',
        messages: { other: '<b>%1$s</b>님이 선물을 보냈습니다.' },
        flag: null,
      },
      {
        context: 'text_left_days',
        key: '%d days',
        messages: { one: '%d day', other: '%d days' },
        flag: null,
      },
    ]
    const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">LIKEY</string>
    <string name="sign_up_ask_comment_v2" format="html">아직 계정이 없으신가요? <font color="#FF424D">회원가입</font></string>
    <string name="sign_up_form_policy_agreement_desc_v2" format="html"><u>서비스 이용약관</u>과 <u>개인정보 처리방침</u>에 동의합니다.</string>
    <string name="user_interest_form_title"><![CDATA[관심사 & 해시태그]]></string>
    <string name="user_interest_edit_req_desc_for_fan" format="html"><b>관심사 선택 기능이 새로 나왔습니다!</b>\\n관심사를 설정하시면 나와 맞는 크리에이터들을 추천해드릴께요!\\n아래에서 최소 3개 이상을 선택해주세요!</string>
    <string name="user_interest_extra_tag_count_format" translatable="false">(+%1$s)</string>
    <string name="alarm_list_item_desc_gift_dm_received"><![CDATA[<b>%1$s</b>님이 선물을 보냈습니다.]]></string>
    <plurals name="text_left_days">
        <item quantity="one">%d day</item>
        <item quantity="other">%d days</item>
    </plurals>
</resources>`
    const targetXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="sign_up_ask_comment_v2" format="html">Don\\'t have an account? <font color="#FF424D">Sign up</font></string>
    <string name="sign_up_form_policy_agreement_desc_v2" format="html"><u>서비스 이용약관</u>과 <u>개인정보 처리방침</u>에 동의합니다.</string>
    <string name="user_interest_form_title"><![CDATA[관심사 & 해시태그]]></string>
    <string name="user_interest_edit_req_desc_for_fan" format="html"><b>관심사 선택 기능이 새로 나왔습니다!</b>\\n관심사를 설정하시면 나와 맞는 크리에이터들을 추천해드릴께요!\\n아래에서 최소 3개 이상을 선택해주세요!</string>
    <string name="alarm_list_item_desc_gift_dm_received"><![CDATA[<b>%1$s</b>님이 선물을 보냈습니다.]]></string>
    <plurals name="text_left_days">
        <item quantity="one">%d day</item>
        <item quantity="other">%d days</item>
    </plurals>
</resources>`

    const dstXml = '<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>'
    const newDstXml = await generateAndroidXml('en', transEntries, srcXml, dstXml)
    assert.equal(newDstXml, targetXml)
  })

  describe('multi-module support', () => {
    describe('filterTransEntriesForModule', () => {
      it('filters entries by module prefix', () => {
        const transEntries: TransEntry[] = [
          { context: 'app:app_name', key: 'MyApp', messages: { other: 'MyApp' }, flag: null },
          { context: 'app:login_button', key: 'Login', messages: { other: 'Login' }, flag: null },
          { context: 'features/auth:auth_title', key: 'Auth', messages: { other: 'Auth' }, flag: null },
          { context: 'features/home:home_title', key: 'Home', messages: { other: 'Home' }, flag: null },
        ]

        const appEntries = filterTransEntriesForModule(transEntries, 'app')
        assert.equal(appEntries.length, 2)
        assert.equal(appEntries[0].context, 'app_name')
        assert.equal(appEntries[1].context, 'login_button')

        const authEntries = filterTransEntriesForModule(transEntries, 'features/auth')
        assert.equal(authEntries.length, 1)
        assert.equal(authEntries[0].context, 'auth_title')

        const homeEntries = filterTransEntriesForModule(transEntries, 'features/home')
        assert.equal(homeEntries.length, 1)
        assert.equal(homeEntries[0].context, 'home_title')
      })

      it('returns empty array when no matching entries', () => {
        const transEntries: TransEntry[] = [
          { context: 'app:app_name', key: 'MyApp', messages: { other: 'MyApp' }, flag: null },
        ]

        const result = filterTransEntriesForModule(transEntries, 'nonexistent')
        assert.equal(result.length, 0)
      })

      it('strips module prefix from context', () => {
        const transEntries: TransEntry[] = [
          { context: 'features/auth:login_button', key: 'Login', messages: { other: 'Login' }, flag: null },
        ]

        const result = filterTransEntriesForModule(transEntries, 'features/auth')
        assert.equal(result[0].context, 'login_button')
        assert.equal(result[0].key, 'Login')
        assert.deepEqual(result[0].messages, { other: 'Login' })
      })

      it('handles entries without context', () => {
        const transEntries: TransEntry[] = [
          { context: null, key: 'NoContext', messages: { other: 'NoContext' }, flag: null },
          { context: 'app:with_context', key: 'WithContext', messages: { other: 'WithContext' }, flag: null },
        ]

        const result = filterTransEntriesForModule(transEntries, 'app')
        assert.equal(result.length, 1)
        assert.equal(result[0].context, 'with_context')
      })
    })

    it('generates xml with filtered module entries', async () => {
      const transEntries: TransEntry[] = [
        { context: 'app_name', key: 'MyApp', messages: { other: 'MyApp EN' }, flag: null },
      ]
      const srcXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp</string>
</resources>`
      const targetXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp EN</string>
</resources>`

      const dstXml = '<?xml version="1.0" encoding="utf-8"?>\n<resources></resources>'
      const newDstXml = await generateAndroidXml('en', transEntries, srcXml, dstXml)
      assert.equal(newDstXml, targetXml)
    })
  })
})
