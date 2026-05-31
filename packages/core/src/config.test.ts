import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { L10nStorageConfig } from './config.js'

describe('L10nStorageConfig', () => {
  const savedSpaceUrl = process.env.TPC_SPACE_URL
  beforeEach(() => {
    delete process.env.TPC_SPACE_URL
  })
  afterEach(() => {
    if (savedSpaceUrl === undefined) {
      delete process.env.TPC_SPACE_URL
    } else {
      process.env.TPC_SPACE_URL = savedSpaceUrl
    }
  })

  describe('getWebUrl', () => {
    it('falls back to the default when neither env nor config is set', () => {
      const sc = new L10nStorageConfig({ projectId: 'p' })
      assert.equal(sc.getWebUrl(), 'https://space.tpcground.com')
    })

    it('uses config web-url over the default', () => {
      const sc = new L10nStorageConfig({ 'projectId': 'p', 'web-url': 'https://space.example.com' })
      assert.equal(sc.getWebUrl(), 'https://space.example.com')
    })

    it('prefers TPC_SPACE_URL env over config and default', () => {
      process.env.TPC_SPACE_URL = 'https://env.example.com'
      const sc = new L10nStorageConfig({ 'projectId': 'p', 'web-url': 'https://space.example.com' })
      assert.equal(sc.getWebUrl(), 'https://env.example.com')
    })

    it('strips trailing slashes', () => {
      const sc = new L10nStorageConfig({ 'projectId': 'p', 'web-url': 'https://space.example.com//' })
      assert.equal(sc.getWebUrl(), 'https://space.example.com')
    })
  })

  describe('getTranslationLink', () => {
    it('builds a tag/source scoped link with a literal slash', () => {
      const sc = new L10nStorageConfig({ projectId: 'proj-123' })
      assert.equal(
        sc.getTranslationLink('backend', 'PR-7676'),
        'https://space.tpcground.com/l10n/translations?project=proj-123&tagSource=backend/PR-7676',
      )
    })

    it('uses the resolved web url', () => {
      process.env.TPC_SPACE_URL = 'https://env.example.com/'
      const sc = new L10nStorageConfig({ projectId: 'proj-123' })
      assert.equal(
        sc.getTranslationLink('email', 'PR-1'),
        'https://env.example.com/l10n/translations?project=proj-123&tagSource=email/PR-1',
      )
    })
  })
})
