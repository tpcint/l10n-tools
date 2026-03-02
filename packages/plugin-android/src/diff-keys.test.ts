import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diffAndroidKeys } from './diff-keys.js'

describe('diffAndroidKeys', () => {
  it('detects new key added', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="existing_key">Existing</string>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="existing_key">Existing</string>
    <string name="new_key">New Value</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file')
    assert.deepEqual(changed, ['new_key'])
  })

  it('detects key content modified', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greeting">Hello</string>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="greeting">Hello World</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file')
    assert.deepEqual(changed, ['greeting'])
  })

  it('ignores unchanged keys', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="key1">Value1</string>
    <string name="key2">Value2</string>
</resources>`
    const changed = diffAndroidKeys(xml, xml, 'test-file')
    assert.deepEqual(changed, [])
  })

  it('ignores deleted keys', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="kept">Kept</string>
    <string name="deleted">Deleted</string>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="kept">Kept</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file')
    assert.deepEqual(changed, [])
  })

  it('includes module prefix in context', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="existing">Existing</string>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="existing">Existing</string>
    <string name="new_key">New</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file', '../app')
    assert.deepEqual(changed, ['app:new_key'])
  })

  it('includes nested module prefix in context', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources></resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="auth_title">Login</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file', '../features/auth')
    assert.deepEqual(changed, ['features/auth:auth_title'])
  })

  it('detects plurals change', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items_count">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="items_count">
        <item quantity="one">%d thing</item>
        <item quantity="other">%d things</item>
    </plurals>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file')
    assert.deepEqual(changed, ['items_count'])
  })

  it('treats empty old content as all keys new', () => {
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="key1">Value1</string>
    <string name="key2">Value2</string>
</resources>`
    const changed = diffAndroidKeys('', newXml, 'test-file')
    assert.deepEqual(changed, ['key1', 'key2'])
  })

  it('ignores translatable=false in both old and new', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="normal">Normal</string>
    <string name="no_trans" translatable="false">No Trans</string>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="normal">Normal</string>
    <string name="no_trans" translatable="false">No Trans Changed</string>
    <string name="added">Added</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file')
    assert.deepEqual(changed, ['added'])
  })

  it('handles mixed additions and modifications', () => {
    const oldXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="unchanged">Same</string>
    <string name="modified">Old Value</string>
    <string name="deleted">Will be deleted</string>
</resources>`
    const newXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="unchanged">Same</string>
    <string name="modified">New Value</string>
    <string name="added">Brand New</string>
</resources>`
    const changed = diffAndroidKeys(oldXml, newXml, 'test-file')
    assert.deepEqual(changed, ['modified', 'added'])
  })
})
