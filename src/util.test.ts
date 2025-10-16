import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { faker } from '@faker-js/faker'
import { isPureKey } from './utils.js'

describe('Util', () => {
  describe('isPureKey', () => {
    it('returns false for empty prefixes', () => {
      const key = faker.lorem.words()
      assert.equal(isPureKey(key, []), false)
    })

    it('returns by prefix matching', () => {
      const matchedKey = '$' + faker.string.sample()
      const unmatchedKey = faker.string.alphanumeric(1) + faker.string.sample()
      const prefix = '$'
      assert.equal(isPureKey(matchedKey, [prefix]), true)
      assert.equal(isPureKey(unmatchedKey, [prefix]), false)
    })
  })
})
