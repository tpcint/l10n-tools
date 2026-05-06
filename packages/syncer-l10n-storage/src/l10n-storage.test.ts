import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyEntry, TransEntry } from 'l10n-tools-core'
import type { L10nKeyToServe } from './api-types.js'
import { buildKeyChanges, updateTransEntries } from './l10n-storage.js'

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
  isPlural?: boolean,
}): L10nKeyToServe {
  return {
    id: opts?.id ?? Math.random().toString(),
    keyName,
    isPlural: opts?.isPlural ?? false,
    tags: opts?.tags ?? [],
    metadata: opts?.metadata ?? [],
    translations: opts?.translations ?? [],
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

  it('should attach suggestions for existing keys without translation', () => {
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

describe('updateTransEntries', () => {
  it('matches server keys via local keyEntry source text and applies translation', () => {
    const keyEntries = [createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' })]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'en', translation: { other: 'Media Access' } },
        ],
      }),
    }
    const allTransEntries = {
      en: [createTransEntry('공개 범위', { other: 'old en value' }, { context: 'post_editor_access_config_title' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.en[0].messages.other, 'Media Access')
  })

  it('uses local source text to disambiguate when same named key is registered under multiple keyName entries', () => {
    // Same named key 'setting_paid_post_config_config_label' is in context of two keyName entries.
    // values/strings.xml has '유료 포스트 앱에서만 열람 설정' as the source,
    // so the matching keyName must be the one identical to the local source.
    const keyEntries = [
      createKeyEntry('유료 포스트 앱에서만 열람 설정', { context: 'setting_paid_post_config_config_label' }),
    ]
    const listedKeyMap = {
      '유료 포스트 앱에서만 열람 설정': createL10nKey('유료 포스트 앱에서만 열람 설정', {
        translations: [
          { locale: 'en', translation: { other: 'Set my paid post to app-only view' } },
        ],
      }),
      '내 유료 포스트 앱에서만 열람 설정': createL10nKey('내 유료 포스트 앱에서만 열람 설정', {
        translations: [
          { locale: 'en', translation: { other: 'WRONG (should not be picked)' } },
        ],
      }),
    }
    const allTransEntries = {
      en: [createTransEntry('유료 포스트 앱에서만 열람 설정', { other: 'old' }, { context: 'setting_paid_post_config_config_label' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.en[0].messages.other, 'Set my paid post to app-only view')
  })

  it('does not touch translation lines whose local key has no matching server keyName', () => {
    const keyEntries = [createKeyEntry('orphan key', { context: 'orphan_named_key' })]
    const listedKeyMap = {}
    const allTransEntries = {
      en: [createTransEntry('orphan key', { other: 'keep me' }, { context: 'orphan_named_key', flag: 'unverified' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.en[0].messages.other, 'keep me')
    // flag is only cleared when a matching server key updates the entry; here it must remain.
    assert.equal(allTransEntries.en[0].flag, 'unverified')
  })

  it('applies localeSyncMap when looking up server translation locale', () => {
    const keyEntries = [createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' })]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'zh-CN', translation: { other: '公开范围' } },
        ],
      }),
    }
    const allTransEntries = {
      'zh-rCN': [createTransEntry('공개 범위', { other: 'old zh-rCN' }, { context: 'post_editor_access_config_title' })],
    }
    const localeSyncMap = { 'zh-rCN': 'zh-CN' }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap, localeSyncMap)

    assert.equal(allTransEntries['zh-rCN'][0].messages.other, '公开范围')
  })

  it('skips when server key has no translation for the requested locale', () => {
    const keyEntries = [createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' })]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'en', translation: { other: 'Media Access' } },
        ],
      }),
    }
    const allTransEntries = {
      ja: [createTransEntry('공개 범위', { other: '既存ja' }, { context: 'post_editor_access_config_title' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.ja[0].messages.other, '既存ja')
  })

  it('clears flag on entries that get updated by a matching server key', () => {
    const keyEntries = [createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' })]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'en', translation: { other: 'Media Access' } },
        ],
      }),
    }
    const allTransEntries = {
      en: [createTransEntry('공개 범위', { other: 'old' }, { context: 'post_editor_access_config_title', flag: 'unverified' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.en[0].flag, null)
  })

  it('applies the same server keyName to multiple local entries that share the source text', () => {
    // server-side normal case: one keyName has many context-named keys mapped to the same source text.
    const keyEntries = [
      createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' }),
      createKeyEntry('공개 범위', { context: 'post_tab_filter_visibility_label' }),
    ]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'en', translation: { other: 'Media Access' } },
        ],
      }),
    }
    const allTransEntries = {
      en: [
        createTransEntry('공개 범위', { other: 'old1' }, { context: 'post_editor_access_config_title' }),
        createTransEntry('공개 범위', { other: 'old2' }, { context: 'post_tab_filter_visibility_label' }),
      ],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.en[0].messages.other, 'Media Access')
    assert.equal(allTransEntries.en[1].messages.other, 'Media Access')
  })

  it('updates plural translations when not equal', () => {
    const keyEntries = [createKeyEntry('plural source', { isPlural: true, context: 'plural_ctx' })]
    const listedKeyMap = {
      'plural source': createL10nKey('plural source', {
        isPlural: true,
        translations: [
          { locale: 'en', translation: { one: 'one item', other: '%d items' } },
        ],
      }),
    }
    const allTransEntries = {
      en: [createTransEntry('plural source', { one: 'old one', other: 'old other' }, { context: 'plural_ctx' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.deepEqual(allTransEntries.en[0].messages, { one: 'one item', other: '%d items' })
  })

  it('does not overwrite when server value equals current value', () => {
    const keyEntries = [createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' })]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'en', translation: { other: 'Media Access' } },
        ],
      }),
    }
    const original = createTransEntry('공개 범위', { other: 'Media Access' }, { context: 'post_editor_access_config_title' })
    const allTransEntries = { en: [original] }
    const beforeMessages = original.messages

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    // identity check: the messages object should not be replaced when equal
    assert.equal(allTransEntries.en[0].messages, beforeMessages)
  })
})
