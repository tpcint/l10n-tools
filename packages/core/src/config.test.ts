import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CompilerConfig, L10nStorageConfig } from './config.js'

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

    it('treats an empty env var as unset and falls back', () => {
      process.env.TPC_SPACE_URL = ''
      const sc = new L10nStorageConfig({ 'projectId': 'p', 'web-url': 'https://space.example.com' })
      assert.equal(sc.getWebUrl(), 'https://space.example.com')
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

describe('CompilerConfig.getScanSrcDirs', () => {
  it('falls back to [src-dir] when scan-src-dirs is omitted', () => {
    const cc = new CompilerConfig({ 'type': 'ios', 'src-dir': '/a' } as never)
    assert.deepEqual(cc.getScanSrcDirs(), ['/a'])
  })

  it('returns the explicit scan-src-dirs list when set', () => {
    const cc = new CompilerConfig({
      'type': 'ios',
      'src-dir': '/a',
      'scan-src-dirs': ['/a', '/b'],
    } as never)
    assert.deepEqual(cc.getScanSrcDirs(), ['/a', '/b'])
  })

  it('allows scan-src-dirs to differ from src-dir (decoupled output vs scan)', () => {
    const cc = new CompilerConfig({
      'type': 'ios',
      'src-dir': '/output',
      'scan-src-dirs': ['/scan1', '/scan2'],
    } as never)
    assert.deepEqual(cc.getScanSrcDirs(), ['/scan1', '/scan2'])
  })

  it('throws when scan-src-dirs is an explicit empty array', () => {
    const cc = new CompilerConfig({
      'type': 'ios',
      'src-dir': '/a',
      'scan-src-dirs': [],
    } as never)
    assert.throws(() => cc.getScanSrcDirs(), /must not be empty/)
  })
})
