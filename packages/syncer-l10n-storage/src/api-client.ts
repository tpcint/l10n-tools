import log from 'npmlog'
import type { CreateL10nKeyInput, L10nKey, ListKeysResponse, UpdateL10nKeyInput } from './api-types.js'

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
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`L10n Storage API error: ${res.status} ${res.statusText} - ${text}`)
    }
    if (res.status === 204) {
      return undefined as T
    }
    return await res.json() as T
  }

  async listAllKeys(projectId: string): Promise<L10nKey[]> {
    const allKeys: L10nKey[] = []
    let cursor: string | undefined
    do {
      log.info('l10n-storage-api', `listing keys${cursor ? ` (cursor: ${cursor})` : ''}`)
      const params = new URLSearchParams({ includeTranslations: '1', limit: '500' })
      if (cursor) params.set('cursor', cursor)
      const response = await this.request<ListKeysResponse>(
        'GET',
        `/api/l10n/projects/${projectId}/keys?${params}`,
      )
      allKeys.push(...response.keys)
      cursor = response.nextCursor ?? undefined
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
