import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPlistDict } from './plist-utils.js'

describe('isPlistDict', () => {
  it('returns true for a plain object dictionary', () => {
    assert.equal(isPlistDict({}), true)
    assert.equal(isPlistDict({ key: 'value' }), true)
    assert.equal(isPlistDict({ nested: { inner: 1 } }), true)
  })

  it('returns false for null', () => {
    assert.equal(isPlistDict(null), false)
  })

  it('returns false for arrays', () => {
    assert.equal(isPlistDict([]), false)
    assert.equal(isPlistDict(['a', 'b']), false)
  })

  it('returns false for primitives', () => {
    assert.equal(isPlistDict('string'), false)
    assert.equal(isPlistDict(42), false)
    assert.equal(isPlistDict(true), false)
    assert.equal(isPlistDict(false), false)
  })

  it('returns false for Date', () => {
    assert.equal(isPlistDict(new Date()), false)
  })

  it('returns false for Uint8Array', () => {
    assert.equal(isPlistDict(new Uint8Array([1, 2, 3])), false)
  })
})
