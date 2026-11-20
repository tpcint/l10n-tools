import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DomainConfig,
  type KeyEntry,
  readKeyEntries,
  type TransEntry,
  type TransMessages,
  writeAllTransEntries,
} from 'l10n-tools-core'
import { extractAndroidKeys } from './extractor.js'
import { compileToAndroidXml } from './compiler.js'

// 공용 키 이관(1-1단계)의 성공 기준: 같은 번역 데이터로 컴파일한 values-xx 가 이관 전과 같아야 한다.
// 이관은 리소스마다 그 리소스의 원문 키 번역을 공용 키로 복사하므로, 테스트도 같은 방식으로 공용 키 번역을 만든다.

const MODULE_XMLS: Record<string, string> = {
  'app': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name" translatable="false">LIKEY</string>
    <string name="publish_button">공개</string>
    <string name="publish_cta">공개</string>
    <string name="live_cast_chat_deleted_by_admin">관리자가 삭제한 메시지입니다.</string>
    <string name="sign_up_ask" format="html">계정이 없으신가요? <font color="#FF424D">회원가입</font></string>
    <string name="interest_title"><![CDATA[관심사 & 해시태그]]></string>
    <string name="escaped">&lt;b&gt;%1$s&lt;/b&gt;님의 \\'선물\\'</string>
    <string name="untranslated_in_ja">일본어 미번역</string>
    <plurals name="left_days">
        <item quantity="other">%d일 남음</item>
    </plurals>
</resources>
`,
  'presentation': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="live_cast_chat_deleted_by_admin">관리자가 삭제한 메시지입니다.</string>
    <string name="confirm">확인</string>
</resources>
`,
  'features/auth': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="login_title">로그인</string>
    <string name="confirm_login">확인</string>
    <plurals name="login_attempts">
        <item quantity="other">%d회 시도</item>
    </plurals>
</resources>
`,
}

// 이관 전에 이미 있던 values-en. 이관 뒤 컴파일도 이 파일을 다시 생성해야 한다.
const STALE_APP_EN_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="publish_button">Old publish</string>
    <string name="removed_key">Removed</string>
</resources>
`

const LOCALES = ['ko', 'en', 'ja']

/** 원문 키마다 고정된 번역. 원문이 같으면 번역도 같다 */
function translate(locale: string, sourceKey: string, isPlural: boolean): TransMessages {
  if (locale === 'ko') {
    return { other: sourceKey }
  }
  if (locale === 'ja' && sourceKey.includes('미번역')) {
    return {}
  }
  if (isPlural && locale === 'en') {
    return { one: `[en:one] ${sourceKey}`, other: `[en] ${sourceKey}` }
  }
  return { other: `[${locale}] ${sourceKey}` }
}

async function setupProject(root: string) {
  for (const [module, xml] of Object.entries(MODULE_XMLS)) {
    const valuesDir = path.join(root, module, 'src', 'main', 'res', 'values')
    await fsp.mkdir(valuesDir, { recursive: true })
    await fsp.writeFile(path.join(valuesDir, 'strings.xml'), xml)
  }
  const appEnDir = path.join(root, 'app', 'src', 'main', 'res', 'values-en')
  await fsp.mkdir(appEnDir, { recursive: true })
  await fsp.writeFile(path.join(appEnDir, 'strings.xml'), STALE_APP_EN_XML)
}

function createDomainConfig(root: string): DomainConfig {
  const modules = Object.keys(MODULE_XMLS).map(module => path.join(root, module))
  const defaultModule = path.join(root, 'app')
  return new DomainConfig({
    'type': 'android',
    'tag': 'android',
    'locales': LOCALES,
    modules,
    'default-module': defaultModule,
    // likey-android 처럼 default-locale 을 지정하지 않으므로 ko 도 values-ko 로 출력한다
    'outputs': [{ 'type': 'android', modules, 'default-module': defaultModule }],
  } as unknown as ConstructorParameters<typeof DomainConfig>[0])
}

async function readOutputs(root: string): Promise<Record<string, string>> {
  const outputs: Record<string, string> = {}
  for (const module of Object.keys(MODULE_XMLS)) {
    const resDir = path.join(root, module, 'src', 'main', 'res')
    for (const dir of await fsp.readdir(resDir)) {
      outputs[`${module}/${dir}`] = await fsp.readFile(path.join(resDir, dir, 'strings.xml'), 'utf-8')
    }
  }
  return outputs
}

describe('id key migration', () => {
  let tmpDir: string
  let sourceRoot: string
  let idRoot: string
  let sourceKeys: KeyEntry[]
  let idKeys: KeyEntry[]

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'l10n-android-id-key-'))
    sourceRoot = path.join(tmpDir, 'source')
    idRoot = path.join(tmpDir, 'id')
    await setupProject(sourceRoot)
    await setupProject(idRoot)

    // 이관 전: 원문 키 모드로 추출하고, 원문 키마다 번역을 부여해 컴파일한다
    const sourceConfig = createDomainConfig(sourceRoot)
    const sourceKeysPath = path.join(tmpDir, 'source-keys.json')
    await extractAndroidKeys('android', sourceConfig, sourceKeysPath)
    sourceKeys = await readKeyEntries(sourceKeysPath)
    const sourceTrans: Record<string, TransEntry[]> = {}
    for (const locale of LOCALES) {
      sourceTrans[locale] = sourceKeys.map(entry => ({
        context: entry.context,
        key: entry.key,
        messages: translate(locale, entry.key, entry.isPlural),
        flag: null,
      }))
    }
    const sourceTransDir = path.join(tmpDir, 'source-trans')
    await fsp.mkdir(sourceTransDir)
    await writeAllTransEntries(sourceTransDir, sourceTrans)
    await compileToAndroidXml('android', sourceConfig.getCompilerConfigs()[0], sourceTransDir)

    // 이관 뒤: 공용 키 모드로 추출하고, 리소스마다 그 리소스의 원문 키 번역을 공용 키로 복사해 컴파일한다
    const sourceKeyByResourceName = new Map<string, string>()
    for (const entry of sourceKeys) {
      sourceKeyByResourceName.set(entry.context!.split(':').at(-1)!, entry.key)
    }
    const idConfig = createDomainConfig(idRoot)
    const idKeysPath = path.join(tmpDir, 'id-keys.json')
    await extractAndroidKeys('android', idConfig, idKeysPath, { keyMode: 'id' })
    idKeys = await readKeyEntries(idKeysPath)
    const idTrans: Record<string, TransEntry[]> = {}
    for (const locale of LOCALES) {
      idTrans[locale] = idKeys.map(entry => ({
        context: null,
        key: entry.key,
        messages: translate(locale, sourceKeyByResourceName.get(entry.key)!, entry.isPlural),
        flag: null,
      }))
    }
    const idTransDir = path.join(tmpDir, 'id-trans')
    await fsp.mkdir(idTransDir)
    await writeAllTransEntries(idTransDir, idTrans)
    await compileToAndroidXml('android', idConfig.getCompilerConfigs()[0], idTransDir, { keyMode: 'id' })
  })

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('extracts one id key per resource name', () => {
    assert.deepEqual(idKeys.map(entry => entry.key).sort(), [
      'confirm',
      'confirm_login',
      'escaped',
      'interest_title',
      'left_days',
      'live_cast_chat_deleted_by_admin',
      'login_attempts',
      'login_title',
      'publish_button',
      'publish_cta',
      'sign_up_ask',
      'untranslated_in_ja',
    ])
    for (const entry of idKeys) {
      assert.equal(entry.context, null)
      assert.equal(entry.idKey?.defaultValue, sourceKeys.find(sourceEntry => sourceEntry.context!.endsWith(entry.key))?.key)
    }
  })

  // `l10n migrate-keys` 는 두 키 방식 추출 결과의 같은 참조 위치를 같은 리소스로 판정한다
  it('records the same reference for a resource in both key modes', () => {
    const idKeyByReference = new Map<string, string>()
    for (const entry of idKeys) {
      for (const ref of entry.references) {
        const file = path.relative(idRoot, ref.file)
        assert.ok(ref.loc != null)
        assert.ok(!idKeyByReference.has(`${file}:${ref.loc}`))
        idKeyByReference.set(`${file}:${ref.loc}`, entry.key)
      }
    }
    for (const entry of sourceKeys) {
      assert.equal(entry.references.length, 1)
      const ref = entry.references[0]
      const resourceName = entry.context!.split(':').at(-1)
      assert.equal(idKeyByReference.get(`${path.relative(sourceRoot, ref.file)}:${ref.loc}`), resourceName)
    }
    assert.equal(idKeyByReference.size, sourceKeys.length)
  })

  it('generates the same values-xx as source key mode', async () => {
    const sourceOutputs = await readOutputs(sourceRoot)
    const idOutputs = await readOutputs(idRoot)
    assert.deepEqual(Object.keys(idOutputs).sort(), Object.keys(sourceOutputs).sort())
    for (const [file, xml] of Object.entries(sourceOutputs)) {
      assert.equal(idOutputs[file], xml, `${file} differs`)
    }
  })

  it('does not change values/strings.xml', async () => {
    const idOutputs = await readOutputs(idRoot)
    for (const [module, xml] of Object.entries(MODULE_XMLS)) {
      assert.equal(idOutputs[`${module}/values`], xml)
    }
  })

  it('writes translations into values-xx', async () => {
    const idOutputs = await readOutputs(idRoot)
    assert.match(idOutputs['app/values-en'], /<string name="publish_cta">\[en\] 공개<\/string>/)
    assert.doesNotMatch(idOutputs['app/values-en'], /removed_key/)
    assert.match(idOutputs['presentation/values-ja'], /<string name="live_cast_chat_deleted_by_admin">\[ja\] 관리자가 삭제한 메시지입니다\.<\/string>/)
    assert.match(idOutputs['features/auth/values-en'], /<item quantity="one">\[en:one\] %d회 시도<\/item>/)
    assert.doesNotMatch(idOutputs['app/values-ja'], /untranslated_in_ja/)
  })
})
