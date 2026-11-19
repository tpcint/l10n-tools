import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { L10nStorageApiClient, SYNCER_VERSION, SYNCER_VERSION_HEADER } from './api-client.js'

const packageVersion = (JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }).version

describe('L10nStorageApiClient', () => {
  let requests: { url: string, init: RequestInit }[]

  beforeEach(() => {
    requests = []
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      if (init.method === 'GET') {
        return Response.json({ keys: [], nextCursor: null })
      }
      return new Response(null, { status: 204 })
    })
  })

  afterEach(() => {
    mock.restoreAll()
  })

  it('reads the syncer version from package.json', () => {
    assert.equal(SYNCER_VERSION, packageVersion)
    assert.match(SYNCER_VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  })

  it('sends the syncer version header on every request', async () => {
    const client = new L10nStorageApiClient('https://example.test/', 'token')

    await client.listAllKeysToServe('project')
    await client.listKeysToServeByTag('project', 'android', 'main')
    await client.createKeys('project', [])
    await client.updateKeys('project', [])

    assert.deepEqual(requests.map(r => r.init.method), ['GET', 'GET', 'POST', 'PUT'])
    for (const { init } of requests) {
      const headers = new Headers(init.headers)
      assert.equal(headers.get(SYNCER_VERSION_HEADER), packageVersion)
      assert.equal(headers.get('Authorization'), 'Bearer token')
    }
  })

  it('splits source text lookups by the server limit and keeps the order', async () => {
    mock.restoreAll()
    const bodies: { texts: { other: string }[] }[] = []
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { texts: { other: string }[] }
      bodies.push(body)
      return Response.json({ results: body.texts.map(text => ({ text, keys: [] })) })
    })
    const client = new L10nStorageApiClient('https://example.test', 'token')
    const texts = Array.from({ length: 1001 }, (_, i) => ({ other: `t${i}` }))

    const results = await client.findKeysBySourceTexts('project', { texts, keyKind: 'id' })

    assert.deepEqual(bodies.map(b => b.texts.length), [1000, 1])
    assert.equal(bodies[1].texts[0].other, 't1000')
    assert.deepEqual(results.map(r => r.text), texts)
  })

  it('uses the header name shared with the l10n-storage server', () => {
    assert.equal(SYNCER_VERSION_HEADER, 'X-L10n-Tools-Syncer-Version')
  })
})
