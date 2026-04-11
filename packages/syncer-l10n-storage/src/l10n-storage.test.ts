import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyEntry, TransEntry } from 'l10n-tools-core'
import type { L10nKey } from './api-types.js'
import { buildKeyChanges } from './l10n-storage.js'

function createKeyEntry(key: string, opts?: { isPlural?: boolean, context?: string | null }): KeyEntry {
  return {
    key,
    isPlural: opts?.isPlural ?? false,
    context: opts?.context ?? null,
    references: [],
    comments: [],
  }
}

function createL10nKey(keyName: string, opts?: {
  id?: string,
  tags?: { tag: string, source: string }[],
  metadata?: { tag: string | null, metaKey: string, metaValue: string }[],
  translations?: { locale: string, translation: Record<string, string> }[],
  suggestions?: { id: string, locale: string, translation: Record<string, string>, status: string }[],
  isPlural?: boolean,
}): L10nKey {
  return {
    id: opts?.id ?? Math.random().toString(),
    keyName,
    isPlural: opts?.isPlural ?? false,
    tags: opts?.tags ?? [],
    metadata: opts?.metadata ?? [],
    translations: opts?.translations ?? [],
    suggestions: opts?.suggestions ?? [],
  }
}

function createTransEntry(key: string, messages: Record<string, string>, opts?: { context?: string | null, flag?: string | null }): TransEntry {
  return {
    key,
    context: opts?.context ?? null,
    messages,
    flag: opts?.flag ?? null,
  }
}

describe('buildKeyChanges', () => {
  it('should create new keys when not in listedKeyMap', () => {
    const keyEntries = [createKeyEntry('new.key')]
    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, {}, {},
    )

    assert.equal(creatingKeys.length, 1)
    assert.equal(updatingKeys.length, 0)
    assert.equal(creatingKeys[0].keyName, 'new.key')
    assert.deepEqual(creatingKeys[0].tags, [{ tag: 'backend', source: 'main' }])
  })

  it('should not add tag when key already has the tag with any source', () => {
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'backend', source: 'main' }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-123', 'backend', keyEntries, {}, listedKeyMap,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 0)
  })

  it('should add tag when key exists but does not have the tag at all', () => {
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'other-tag', source: 'main' }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, {}, listedKeyMap,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].addTags, [{ tag: 'backend', source: 'main' }])
  })

  it('should attach suggestions for new keys with translations', () => {
    const keyEntries = [createKeyEntry('new.key')]
    const allTransEntries = {
      ko: [createTransEntry('new.key', { other: '새 키' })],
    }

    const { creatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, allTransEntries, {},
    )

    assert.equal(creatingKeys.length, 1)
    assert.equal(creatingKeys[0].suggestions?.length, 1)
    assert.equal(creatingKeys[0].suggestions?.[0].locale, 'ko')
    assert.deepEqual(creatingKeys[0].suggestions?.[0].translation, { other: '새 키' })
  })

  it('should attach suggestions for existing keys without translation or suggestion', () => {
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'backend', source: 'main' }],
      }),
    }
    const allTransEntries = {
      ko: [createTransEntry('existing.key', { other: '기존 키' })],
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, allTransEntries, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 1)
    assert.equal(updatingKeys[0].suggestions?.length, 1)
    assert.equal(updatingKeys[0].suggestions?.[0].locale, 'ko')
  })

  it('should not attach suggestion when key already has translation for locale', () => {
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'backend', source: 'main' }],
        translations: [{ locale: 'ko', translation: { other: '이미 번역됨' } }],
      }),
    }
    const allTransEntries = {
      ko: [createTransEntry('existing.key', { other: '기존 키' })],
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, allTransEntries, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 0)
  })

  it('should skip translations with empty messages.other', () => {
    const keyEntries = [createKeyEntry('new.key')]
    const allTransEntries = {
      ko: [createTransEntry('new.key', {})],
    }

    const { creatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, allTransEntries, {},
    )

    assert.equal(creatingKeys[0].suggestions, undefined)
  })

  it('should apply localeSyncMap to suggestion locales', () => {
    const keyEntries = [createKeyEntry('new.key')]
    const allTransEntries = {
      'zh-Hant': [createTransEntry('new.key', { other: '繁體' })],
    }
    const localeSyncMap = { 'zh-Hant': 'zh_TW' }

    const { creatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, allTransEntries, {}, localeSyncMap,
    )

    assert.equal(creatingKeys[0].suggestions?.length, 1)
    assert.equal(creatingKeys[0].suggestions?.[0].locale, 'zh_TW')
  })

  it('should apply localeSyncMap when checking existing translations', () => {
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'backend', source: 'main' }],
        translations: [{ locale: 'zh_TW', translation: { other: '已翻譯' } }],
      }),
    }
    const allTransEntries = {
      'zh-Hant': [createTransEntry('existing.key', { other: '繁體' })],
    }
    const localeSyncMap = { 'zh-Hant': 'zh_TW' }

    const { updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, allTransEntries, listedKeyMap, localeSyncMap,
    )

    // zh_TW already has translation, so no suggestion should be added
    assert.equal(updatingKeys.length, 0)
  })

  it('Pass 1: should only remove context for own source tags', () => {
    // key has tag from 'main' source with context 'ctx1'
    // but local keyEntries don't have this key with context 'ctx1'
    // → should remove context and tag for 'main' source
    const keyEntries: KeyEntry[] = []
    const listedKeyMap = {
      'removed.key': createL10nKey('removed.key', {
        id: 'key-1',
        tags: [{ tag: 'backend', source: 'main' }],
        metadata: [{ tag: 'backend', metaKey: 'context', metaValue: '["ctx1"]' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, {}, listedKeyMap,
    )

    // Should have an update to remove context and tag
    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].removeTags, [{ tag: 'backend', source: 'main' }])
  })

  it('Pass 1: should not touch keys owned by different source', () => {
    const keyEntries: KeyEntry[] = []
    const listedKeyMap = {
      'other.key': createL10nKey('other.key', {
        tags: [{ tag: 'backend', source: 'other-source' }],
        metadata: [{ tag: 'backend', metaKey: 'context', metaValue: '' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'backend', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 0)
  })
})
