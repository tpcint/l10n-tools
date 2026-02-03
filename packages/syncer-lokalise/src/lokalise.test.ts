import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyEntry, TransEntry } from 'l10n-tools-core'
import type { Key } from '@lokalise/node-api'
import { createNewKeyData, updateKeyData } from './lokalise.js'

function createKeyEntry(key: string, isPlural = false, context: string | null = null): KeyEntry {
  return {
    key,
    isPlural,
    context,
    references: [],
    comments: [],
  }
}

function createMockKey(keyName: string, tags: string[] = [], platforms: string[] = ['web']): Key {
  return {
    key_id: Math.random().toString(),
    key_name: { web: keyName, ios: keyName, android: keyName, other: keyName },
    platforms,
    tags,
    translations: [],
    is_plural: false,
    context: '',
    description: '',
    created_at: '',
    created_at_timestamp: 0,
    filenames: {},
    comments: [],
    screenshots: [],
    base_words: 0,
    char_limit: 0,
    custom_attributes: [],
    modified_at: '',
    modified_at_timestamp: 0,
    is_hidden: false,
    is_archived: false,
    plural_forms: [],
    task_id: null,
  } as unknown as Key
}

describe('lokalise', () => {
  describe('createNewKeyData', () => {
    it('should include domain tag only when additionalTags is undefined', () => {
      const keyEntry = createKeyEntry('test.key')
      const result = createNewKeyData('web', 'domain-tag', keyEntry, undefined)

      assert.deepEqual(result.tags, ['domain-tag'])
    })

    it('should include domain tag only when additionalTags is empty', () => {
      const keyEntry = createKeyEntry('test.key')
      const result = createNewKeyData('web', 'domain-tag', keyEntry, [])

      assert.deepEqual(result.tags, ['domain-tag'])
    })

    it('should include domain tag and additionalTags', () => {
      const keyEntry = createKeyEntry('test.key')
      const additionalTags = ['release-2024', 'feature-x']
      const result = createNewKeyData('web', 'domain-tag', keyEntry, additionalTags)

      assert.deepEqual(result.tags, ['domain-tag', 'release-2024', 'feature-x'])
    })

    it('should preserve key properties', () => {
      const keyEntry = createKeyEntry('test.key', true, 'some-context')
      const result = createNewKeyData('ios', 'domain-tag', keyEntry, ['extra-tag'])

      assert.equal(result.key_name, 'test.key')
      assert.equal(result.is_plural, true)
      assert.deepEqual(result.platforms, ['ios'])
    })
  })

  describe('updateKeyData', () => {
    it('should create new keys with additionalTags', () => {
      const keyEntries: KeyEntry[] = [
        createKeyEntry('new.key.1'),
        createKeyEntry('new.key.2'),
      ]
      const allTransEntries: { [locale: string]: TransEntry[] } = {}
      const listedKeyMap: { [keyName: string]: Key } = {}
      const additionalTags = ['release-2024', 'feature-x']

      const { creatingKeyMap, updatingKeyMap } = updateKeyData(
        'web',
        'domain-tag',
        keyEntries,
        allTransEntries,
        listedKeyMap,
        additionalTags,
      )

      assert.equal(Object.keys(creatingKeyMap).length, 2)
      assert.equal(Object.keys(updatingKeyMap).length, 0)

      for (const key of Object.values(creatingKeyMap)) {
        assert.deepEqual(key.tags, ['domain-tag', 'release-2024', 'feature-x'])
      }
    })

    it('should not apply additionalTags to updated keys', () => {
      const keyEntries: KeyEntry[] = [createKeyEntry('existing.key')]
      const allTransEntries: { [locale: string]: TransEntry[] } = {}
      const listedKeyMap: { [keyName: string]: Key } = {
        'existing.key': createMockKey('existing.key', ['other-tag'], ['ios']),
      }
      const additionalTags = ['release-2024']

      const { creatingKeyMap, updatingKeyMap } = updateKeyData(
        'web',
        'domain-tag',
        keyEntries,
        allTransEntries,
        listedKeyMap,
        additionalTags,
      )

      assert.equal(Object.keys(creatingKeyMap).length, 0)
      assert.equal(Object.keys(updatingKeyMap).length, 1)

      const updatedKey = updatingKeyMap['existing.key']
      // Should have domain-tag added, but NOT additionalTags
      assert.ok(updatedKey.tags?.includes('domain-tag'))
      assert.ok(updatedKey.tags?.includes('other-tag'))
      assert.ok(!updatedKey.tags?.includes('release-2024'))
    })

    it('should not update keys that already have domain tag and platform', () => {
      const keyEntries: KeyEntry[] = [createKeyEntry('existing.key')]
      const allTransEntries: { [locale: string]: TransEntry[] } = {}
      const listedKeyMap: { [keyName: string]: Key } = {
        'existing.key': createMockKey('existing.key', ['domain-tag'], ['web']),
      }

      const { creatingKeyMap, updatingKeyMap } = updateKeyData(
        'web',
        'domain-tag',
        keyEntries,
        allTransEntries,
        listedKeyMap,
        ['extra-tag'],
      )

      assert.equal(Object.keys(creatingKeyMap).length, 0)
      assert.equal(Object.keys(updatingKeyMap).length, 0)
    })

    it('should work without additionalTags', () => {
      const keyEntries: KeyEntry[] = [createKeyEntry('new.key')]
      const allTransEntries: { [locale: string]: TransEntry[] } = {}
      const listedKeyMap: { [keyName: string]: Key } = {}

      const { creatingKeyMap } = updateKeyData(
        'web',
        'domain-tag',
        keyEntries,
        allTransEntries,
        listedKeyMap,
        undefined,
      )

      assert.equal(Object.keys(creatingKeyMap).length, 1)
      assert.deepEqual(creatingKeyMap['new.key'].tags, ['domain-tag'])
    })
  })
})
