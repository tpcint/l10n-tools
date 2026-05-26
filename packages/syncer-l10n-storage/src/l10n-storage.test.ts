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

  it('should NOT claim (tag, source) for non-authoritative source when no new context is added', () => {
    // A PR-scoped sync (non-authoritative source) extracts the entire local file, so every
    // key flows through Pass 2 even if the PR did not touch it. To avoid PR-N claiming every
    // key in the project — which previously caused ~2000-key "upload" notifications on
    // PRs that only deleted a handful of strings — claim must require an actual new context.
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'backend', source: 'main' }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-123', 'backend', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 0)
  })

  it('should NOT claim (tag, source) for non-authoritative source when only references change', () => {
    // References (file:line) drift with PR diffs but are not exposed by the source filter,
    // so PR-N must not claim ownership just because file locations changed.
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), references: [{ file: 'app/values/strings.xml', loc: '99' }] },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [
          { tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a']) },
          { tag: 'android-likey', metaKey: 'references', metaValue: JSON.stringify([{ file: 'app/values/strings.xml', loc: '12' }]) },
        ],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'PR-1692', 'android-likey', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    // refs are updated, but no (tag, source) claim
    assert.equal(updatingKeys.length, 1)
    assert.equal(updatingKeys[0].addTags, undefined)
    const refsMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'references')
    assert.ok(refsMeta != null)
  })

  it('should NOT claim (tag, source) for non-authoritative source when only description changes', () => {
    // Description metadata is not exposed by the source filter either, so a description-only
    // change does not warrant a PR-N claim.
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), comments: ['New developer note'] },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a']) }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'PR-42', 'android-likey', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(updatingKeys.length, 1)
    assert.equal(updatingKeys[0].addTags, undefined)
    const descMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'description')
    assert.ok(descMeta != null)
  })

  it('should not add tag when key already has the tag with the same source', () => {
    const keyEntries = [createKeyEntry('existing.key')]
    const listedKeyMap = {
      'existing.key': createL10nKey('existing.key', {
        tags: [{ tag: 'backend', source: 'PR-123' }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-123', 'backend', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
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

  it('should add (tag, source) when a new context is added to an existing keyName', () => {
    // Regression: a PR that adds a new Android `name` reusing existing translation
    // text must tag the server key with (tag, source) so that the PR's source
    // filter can include the key for compile-from-source. Previously only the
    // context metadata was updated, leaving the source filter blind to this key.
    const keyEntries = [
      createKeyEntry('취소', { context: 'prsnt_membership_coupon_issue_cancel' }),
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['cancel']) }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-99', 'android-likey', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].addTags, [{ tag: 'android-likey', source: 'PR-99' }])
    const contextMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'context')
    assert.ok(contextMeta != null)
    assert.deepEqual(JSON.parse(contextMeta.metaValue), ['cancel', 'prsnt_membership_coupon_issue_cancel'])
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

  it('Pass 2: accumulates contexts when same keyName appears with multiple contexts (existing key)', () => {
    // Android에서 동일 원문이 여러 <string name>에 쓰이는 흔한 패턴. 한 번의 sync에서 같은 keyName이
    // 서로 다른 context로 여러 KeyEntry로 들어와도 setMetadata의 (tag, 'context') 엔트리가 서로를
    // 덮어쓰지 않고 두 context가 모두 누적되어야 한다.
    const keyEntries = [
      createKeyEntry('취소', { context: 'a:cancel_button' }),
      createKeyEntry('취소', { context: 'b:dialog_cancel' }),
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['legacy_ctx']) }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 1)
    const contextMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'context')
    assert.ok(contextMeta != null)
    assert.deepEqual(
      JSON.parse(contextMeta.metaValue),
      ['legacy_ctx', 'a:cancel_button', 'b:dialog_cancel'],
    )
  })

  it('Pass 2: addTags pushes (tag, source) only once across multiple entries with same keyName', () => {
    // 같은 keyName이 여러 context로 들어와도 addTags에 동일 (tag, source)가 여러 번 push되면 안 된다.
    const keyEntries = [
      createKeyEntry('취소', { context: 'a:one' }),
      createKeyEntry('취소', { context: 'b:two' }),
      createKeyEntry('취소', { context: 'c:three' }),
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'PR-77', 'android-likey', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].addTags, [{ tag: 'android-likey', source: 'PR-77' }])
  })

  it('Pass 2: merges description comments across multiple entries with same keyName', () => {
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), comments: ['Used on the cancel button'] },
      { ...createKeyEntry('취소', { context: 'b' }), comments: ['Also used in confirmation dialog'] },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [{ tag: 'android-likey', metaKey: 'description', metaValue: 'Pre-existing note' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 1)
    const descMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'description')
    assert.ok(descMeta != null)
    assert.equal(
      descMeta.metaValue,
      'Pre-existing note\nUsed on the cancel button\nAlso used in confirmation dialog',
    )
  })

  it('Pass 2: merges references across multiple entries with same keyName into one setMetadata', () => {
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), references: [{ file: 'app/values/strings.xml', loc: '12' }] },
      { ...createKeyEntry('취소', { context: 'b' }), references: [{ file: 'lib/values/strings.xml', loc: '7' }] },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 1)
    const refsMetaList = updatingKeys[0].setMetadata?.filter(m => m.metaKey === 'references') ?? []
    assert.equal(refsMetaList.length, 1)
    assert.deepEqual(JSON.parse(refsMetaList[0].metaValue), [
      { file: 'app/values/strings.xml', loc: '12' },
      { file: 'lib/values/strings.xml', loc: '7' },
    ])
  })

  it('Pass 2: skips references setMetadata when value is unchanged', () => {
    const sameRefs = [{ file: 'app/values/strings.xml', loc: '12' }]
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), references: sameRefs },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [
          { tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a']) },
          { tag: 'android-likey', metaKey: 'references', metaValue: JSON.stringify(sameRefs) },
        ],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 0)
  })

  it('Pass 2: clears stale references metadata when this sync produces no refs but server has stale ones', () => {
    // 이전 sync에 file:loc가 남아 있고, 이번 sync의 entries에는 references가 없는 경우,
    // 기존 메타가 그대로 남으면 stale `file:loc`가 계속 보존되므로 빈 array로 명시적 cleanup이 필요하다.
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), references: [] },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [
          { tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a']) },
          {
            tag: 'android-likey',
            metaKey: 'references',
            metaValue: JSON.stringify([{ file: 'app/values/strings.xml', loc: '12' }]),
          },
        ],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 1)
    const refsMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'references')
    assert.ok(refsMeta != null)
    assert.deepEqual(JSON.parse(refsMeta.metaValue), [])
  })

  it('Pass 2: does not touch references metadata when both this sync and server have no refs', () => {
    const keyEntries: KeyEntry[] = [
      { ...createKeyEntry('취소', { context: 'a' }), references: [] },
    ]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a']) }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, listedKeyMap,
    )

    assert.equal(updatingKeys.length, 0)
  })

  it('Pass 2: accumulates contexts when same keyName appears with multiple contexts (new key)', () => {
    // 새 키 생성 분기에서도 같은 keyName의 여러 entry가 group으로 처리되어 모든 context가 들어가야 한다.
    const keyEntries = [
      createKeyEntry('취소', { context: 'a:one' }),
      createKeyEntry('취소', { context: 'b:two' }),
    ]

    const { creatingKeys } = buildKeyChanges(
      'main', 'android-likey', keyEntries, {}, {},
    )

    assert.equal(creatingKeys.length, 1)
    const contextMeta = creatingKeys[0].metadata?.find(m => m.metaKey === 'context')
    assert.ok(contextMeta != null)
    assert.deepEqual(JSON.parse(contextMeta.metaValue), ['a:one', 'b:two'])
  })

  it('Pass 1: non-authoritative source drops its own orphan (tag, source) but never touches shared context', () => {
    // A PR source claimed the key on a previous sync, but the PR's local no longer extracts it.
    // The PR-N tag is now an orphan: it keeps _remoteCount/source filter surfacing the key,
    // freezing the check run on "Translations are not applied". So the PR's own (tag, source)
    // must be removed. Crucially, the shared context metadata (["main_ctx", "pr_ctx"]) must NOT
    // be touched — contexts are shared across sources per tag, and 'main' still uses them.
    const keyEntries: KeyEntry[] = []
    const listedKeyMap = {
      'shared.key': createL10nKey('shared.key', {
        id: 'key-1',
        tags: [
          { tag: 'backend', source: 'main' },
          { tag: 'backend', source: 'PR-7' },
        ],
        metadata: [{ tag: 'backend', metaKey: 'context', metaValue: '["main_ctx", "pr_ctx"]' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'PR-7', 'backend', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(updatingKeys.length, 1)
    assert.equal(updatingKeys[0].keyId, 'key-1')
    assert.deepEqual(updatingKeys[0].removeTags, [{ tag: 'backend', source: 'PR-7' }])
    // shared context metadata untouched
    assert.equal(updatingKeys[0].setMetadata, undefined)
    assert.equal(updatingKeys[0].addTags, undefined)
  })

  it('non-authoritative source claims an existing key first introduced by this tag (no context, e.g. web4)', () => {
    // Regression (#346): a context-less domain like likey-web-4 vue-i18n never produces a new
    // context, so the old `contextAdded`-only rule meant a PR could never claim an existing key.
    // When the key already exists on the server under another tag (created by a different repo)
    // and this tag has never owned it, the PR-N source must claim (tag, source) so the source
    // filter / _remoteCount surface it for compile-from-source.
    const keyEntries = [createKeyEntry('취소')] // context null
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'web', source: 'main' }], // owned by 'web', never by 'web4'
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-1', 'web4', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].addTags, [{ tag: 'web4', source: 'PR-1' }])
  })

  it('non-authoritative source does NOT claim an existing key this tag already owns (no flood)', () => {
    // "불러오는 중..." 유형: main이 이미 (web4, main)으로 소유하고 번역까지 끝난 키. PR이 단순히
    // 추출에 포함시켰다고 claim하면 PR마다 모든 web4 키가 잡혀 #346 폭주가 재현된다. 자기 태그가
    // 이미 있으므로 claim하지 않아야 한다.
    const keyEntries = [createKeyEntry('불러오는 중...')] // context null
    const listedKeyMap = {
      '불러오는 중...': createL10nKey('불러오는 중...', {
        tags: [{ tag: 'web4', source: 'main' }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-1', 'web4', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 0)
  })

  it('non-authoritative source still claims when a new context is added (context-ful domain, e.g. Android)', () => {
    // Regression guard for the original #346 fix: in a context-ful domain, adding a brand-new
    // context to an existing key must still claim (tag, source) via the contextAdded path,
    // independent of the new hasAnyOwnTag path.
    const keyEntries = [createKeyEntry('취소', { context: 'b' })]
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'android-likey', source: 'main' }],
        metadata: [{ tag: 'android-likey', metaKey: 'context', metaValue: JSON.stringify(['a']) }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-9', 'android-likey', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].addTags, [{ tag: 'android-likey', source: 'PR-9' }])
    const contextMeta = updatingKeys[0].setMetadata?.find(m => m.metaKey === 'context')
    assert.ok(contextMeta != null)
    assert.deepEqual(JSON.parse(contextMeta.metaValue), ['a', 'b'])
  })

  it('Pass 1 (non-authoritative): does NOT remove tag for a key still present in local extraction', () => {
    // The key carries its own (tag, source) claim and is still extracted locally → it is a live
    // claim, not an orphan, so Pass 1 must leave it alone (Pass 2 keeps the claim).
    const keyEntries = [createKeyEntry('살아있는키')]
    const listedKeyMap = {
      살아있는키: createL10nKey('살아있는키', {
        id: 'live-1',
        tags: [{ tag: 'web4', source: 'PR-1' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'PR-1', 'web4', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    const removeTagUpdates = updatingKeys.filter(u => u.removeTags != null)
    assert.equal(removeTagUpdates.length, 0)
  })

  it('Pass 1 (non-authoritative): leaves the key itself (and other-source tags) intact when dropping an orphan', () => {
    // Removing the orphan PR-1 tag must not remove the (web4, main) tag nor delete the key.
    const keyEntries: KeyEntry[] = []
    const listedKeyMap = {
      지워진키: createL10nKey('지워진키', {
        id: 'orphan-1',
        tags: [{ tag: 'web4', source: 'PR-1' }, { tag: 'web4', source: 'main' }],
        metadata: [{ tag: 'web4', metaKey: 'context', metaValue: JSON.stringify(['shared']) }],
      }),
    }

    const { creatingKeys, updatingKeys } = buildKeyChanges(
      'PR-1', 'web4', keyEntries, {}, listedKeyMap, undefined, undefined, /* isAuthoritativeSource */ false,
    )

    assert.equal(creatingKeys.length, 0)
    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].removeTags, [{ tag: 'web4', source: 'PR-1' }])
    // (web4, main) is not removed and shared context is untouched
    assert.equal(updatingKeys[0].setMetadata, undefined)
  })

  it('Pass 1 (authoritative): unaffected by 수정 A/B — claims own tag for a key it does not yet own', () => {
    // main is authoritative; even with the new hasAnyOwnTag path, authoritative short-circuits
    // first, so a key it doesn't own yet is still claimed exactly as before.
    const keyEntries = [createKeyEntry('취소')] // context null
    const listedKeyMap = {
      취소: createL10nKey('취소', {
        tags: [{ tag: 'web', source: 'main' }],
      }),
    }

    const { updatingKeys } = buildKeyChanges(
      'main', 'web4', keyEntries, {}, listedKeyMap, // isAuthoritativeSource defaults to true
    )

    assert.equal(updatingKeys.length, 1)
    assert.deepEqual(updatingKeys[0].addTags, [{ tag: 'web4', source: 'main' }])
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

  it('clears flag even when server value equals current value', () => {
    const keyEntries = [createKeyEntry('공개 범위', { context: 'post_editor_access_config_title' })]
    const listedKeyMap = {
      '공개 범위': createL10nKey('공개 범위', {
        translations: [
          { locale: 'en', translation: { other: 'Media Access' } },
        ],
      }),
    }
    const allTransEntries = {
      en: [createTransEntry('공개 범위', { other: 'Media Access' }, { context: 'post_editor_access_config_title', flag: 'unverified' })],
    }

    updateTransEntries(keyEntries, allTransEntries, listedKeyMap)

    assert.equal(allTransEntries.en[0].flag, null)
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
