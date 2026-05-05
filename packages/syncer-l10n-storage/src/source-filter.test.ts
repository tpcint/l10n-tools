import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { L10nKeyToServe } from './api-types.js'
import { toSnapshot } from './source-filter.js'

function createL10nKey(keyName: string, opts?: {
  id?: string,
  isPlural?: boolean,
  tags?: { tag: string, source: string }[],
  metadata?: { tag: string | null, metaKey: string, metaValue: string }[],
  translations?: { locale: string, translation: Record<string, string> }[],
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

describe('toSnapshot', () => {
  it('returns [null] context when metadata has no contexts', () => {
    const key = createL10nKey('greet', {
      translations: [{ locale: 'ko', translation: { other: '안녕' } }],
    })
    const snap = toSnapshot(key, 'web', undefined)
    assert.deepEqual(snap.contexts, [null])
    assert.equal(snap.keyName, 'greet')
    assert.deepEqual(snap.translations.ko, { other: '안녕' })
  })

  it('uses contexts from metadata when present', () => {
    const key = createL10nKey('greet', {
      metadata: [{ tag: 'web', metaKey: 'context', metaValue: JSON.stringify(['ctx1', 'ctx2']) }],
      translations: [{ locale: 'ko', translation: { other: '안녕' } }],
    })
    const snap = toSnapshot(key, 'web', undefined)
    assert.deepEqual(snap.contexts, ['ctx1', 'ctx2'])
  })

  it('ignores contexts from other tags', () => {
    const key = createL10nKey('greet', {
      metadata: [{ tag: 'mobile', metaKey: 'context', metaValue: JSON.stringify(['ctx-mobile']) }],
    })
    const snap = toSnapshot(key, 'web', undefined)
    assert.deepEqual(snap.contexts, [null])
  })

  it('applies invertedSyncMap to translation locales', () => {
    const key = createL10nKey('greet', {
      translations: [
        { locale: 'ko-KR', translation: { other: '안녕' } },
        { locale: 'en-US', translation: { other: 'hi' } },
      ],
    })
    const invertedSyncMap = { 'ko-KR': 'ko', 'en-US': 'en' }
    const snap = toSnapshot(key, 'web', invertedSyncMap)
    assert.deepEqual(snap.translations.ko, { other: '안녕' })
    assert.deepEqual(snap.translations.en, { other: 'hi' })
    assert.equal(snap.translations['ko-KR'], undefined)
  })

  it('passes through plural translations preserving non-empty forms', () => {
    const key = createL10nKey('items', {
      isPlural: true,
      translations: [{
        locale: 'en',
        translation: { one: 'item', other: 'items', few: '' },
      }],
    })
    const snap = toSnapshot(key, 'web', undefined)
    assert.deepEqual(snap.translations.en, { one: 'item', other: 'items' })
  })

  it('returns empty messages when non-plural translation has no other', () => {
    const key = createL10nKey('greet', {
      translations: [{ locale: 'ko', translation: {} }],
    })
    const snap = toSnapshot(key, 'web', undefined)
    assert.deepEqual(snap.translations.ko, {})
  })
})
