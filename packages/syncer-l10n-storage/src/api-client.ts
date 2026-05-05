import log from 'npmlog'
import type { CreateL10nKeyInput, L10nKeyToServe, ListKeysToServeResponse, UpdateL10nKeyInput } from './api-types.js'

export class L10nStorageApiClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`
    log.verbose('l10n-storage-api', `${method} ${url}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`L10n Storage API error: ${res.status} ${res.statusText} - ${text}`)
    }
    if (res.status === 204) {
      return undefined as T
    }
    return await res.json() as T
  }

  async listAllKeysToServe(projectId: string): Promise<L10nKeyToServe[]> {
    const allKeys: L10nKeyToServe[] = []
    let cursor: string | undefined
    let previousCursor: string | undefined
    do {
      log.info('l10n-storage-api', `listing keys${cursor ? ` (cursor: ${cursor})` : ''}`)
      const params = new URLSearchParams({ limit: '500' })
      if (cursor) params.set('cursor', cursor)
      const response = await this.request<ListKeysToServeResponse>(
        'GET',
        `/api/l10n/projects/${projectId}/keys-to-serve?${params}`,
      )
      allKeys.push(...response.keys)
      previousCursor = cursor
      cursor = response.nextCursor ?? undefined
      if (cursor && cursor === previousCursor) {
        throw new Error(`L10n Storage API pagination loop detected: cursor ${cursor} repeated`)
      }
      log.info('l10n-storage-api', `fetched ${response.keys.length} keys (total: ${allKeys.length})`)
    } while (cursor)
    return allKeys
  }

  async listKeysToServeByTag(
    projectId: string,
    tag: string,
    source?: string,
  ): Promise<L10nKeyToServe[]> {
    const allKeys: L10nKeyToServe[] = []
    let cursor: string | undefined
    let previousCursor: string | undefined
    const encodedTag = encodeURIComponent(tag)
    do {
      log.info(
        'l10n-storage-api',
        `listing keys (tag: ${tag}${source ? `, source: ${source}` : ''}${cursor ? `, cursor: ${cursor}` : ''})`,
      )
      const params = new URLSearchParams({ limit: '500' })
      if (cursor) params.set('cursor', cursor)
      if (source) params.set('source', source)
      const response = await this.request<ListKeysToServeResponse>(
        'GET',
        `/api/l10n/projects/${projectId}/tags/${encodedTag}/keys-to-serve?${params}`,
      )
      allKeys.push(...response.keys)
      previousCursor = cursor
      cursor = response.nextCursor ?? undefined
      if (cursor && cursor === previousCursor) {
        throw new Error(`L10n Storage API pagination loop detected: cursor ${cursor} repeated`)
      }
      log.info('l10n-storage-api', `fetched ${response.keys.length} keys (total: ${allKeys.length})`)
    } while (cursor)
    return allKeys
  }

  async createKeys(projectId: string, keys: CreateL10nKeyInput[]): Promise<void> {
    await this.request('POST', `/api/l10n/projects/${projectId}/keys`, { keys })
  }

  async updateKeys(projectId: string, keys: UpdateL10nKeyInput[]): Promise<void> {
    await this.request('PUT', `/api/l10n/projects/${projectId}/keys`, { keys })
  }
}
