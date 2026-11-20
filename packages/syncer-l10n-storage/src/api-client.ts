import { readFileSync } from 'node:fs'
import log from 'npmlog'
import { chunk } from 'es-toolkit/compat'
import type { L10nConfig } from 'l10n-tools-core'
import type {
  CreateL10nKeyInput,
  FindKeysBySourceTextsInput,
  FindKeysBySourceTextsResponse,
  L10nKeyMigrationError,
  L10nKeyMigrationInput,
  L10nKeyMigrationInvalidPayload,
  L10nKeyMigrationResponse,
  L10nKeyMigrationRollbackInput,
  L10nKeyMigrationRollbackResponse,
  L10nKeyToServe,
  L10nSourceTextMatchResult,
  L10nSyncerUpgradeRequiredPayload,
  L10nTagSyncSettings,
  ListKeysToServeResponse,
  UpdateL10nKeyInput,
} from './api-types.js'

export const SYNCER_VERSION_HEADER = 'X-L10n-Tools-Syncer-Version'

// src/ 와 dist/ 모두 패키지 루트 바로 아래이므로 같은 상대 경로로 이 패키지의 package.json 을 읽는다.
// 서버가 이 값으로 최소 버전을 검사하므로 release-please 가 올린 버전과 같아야 한다.
export const SYNCER_VERSION = (JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string }).version

/** 서버 응답 상태 코드를 확인할 수 있는 API 오류 */
export class L10nStorageApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'L10nStorageApiError'
    this.status = status
  }
}

/**
 * 태그의 `minSyncerVersion` 보다 낮은 syncer 라서 서버가 426 으로 거부했다.
 * `message` 는 서버가 반환한 사람이 읽는 안내(`desc`)다.
 */
export class L10nSyncerUpgradeRequiredError extends L10nStorageApiError {
  readonly payload: L10nSyncerUpgradeRequiredPayload | null

  constructor(desc: string, payload: L10nSyncerUpgradeRequiredPayload | null) {
    super(426, desc)
    this.name = 'L10nSyncerUpgradeRequiredError'
    this.payload = payload
  }
}

/** 이관 계획에 오류가 있어 서버가 아무것도 기록하지 않고 400 으로 거부했다 */
export class L10nKeyMigrationInvalidError extends L10nStorageApiError {
  readonly errors: L10nKeyMigrationError[]

  constructor(desc: string, errors: L10nKeyMigrationError[]) {
    super(400, desc)
    this.name = 'L10nKeyMigrationInvalidError'
    this.errors = errors
  }
}

interface ApiErrorBody {
  name: string,
  desc: string,
  /** 오류마다 정한 payload 를 JSON 으로 직렬화한 문자열 */
  payload: unknown,
}

/** 서버 오류 응답에서 `name`·`desc` 와 JSON 으로 해석한 `payload` 를 읽는다. 형식이 다르면 null */
function parseApiErrorBody(text: string): ApiErrorBody | null {
  let body: { name?: unknown, desc?: unknown, payload?: unknown }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return null
  }
  if (typeof body.name !== 'string' || typeof body.desc !== 'string') {
    return null
  }
  let payload: unknown = null
  if (typeof body.payload === 'string') {
    try {
      payload = JSON.parse(body.payload)
    } catch {
      payload = null
    }
  }
  return { name: body.name, desc: body.desc, payload }
}

function parseUpgradeRequired(text: string): L10nSyncerUpgradeRequiredError | null {
  const body = parseApiErrorBody(text)
  if (body == null || body.name !== 'L10nSyncerUpgradeRequired') {
    return null
  }
  return new L10nSyncerUpgradeRequiredError(body.desc, body.payload as L10nSyncerUpgradeRequiredPayload | null)
}

function parseKeyMigrationInvalid(text: string): L10nKeyMigrationInvalidError | null {
  const body = parseApiErrorBody(text)
  if (body == null || body.name !== 'L10nKeyMigrationInvalid') {
    return null
  }
  const errors = (body.payload as L10nKeyMigrationInvalidPayload | null)?.errors
  return new L10nKeyMigrationInvalidError(body.desc, Array.isArray(errors) ? errors : [])
}

/** `POST /keys/by-source-texts` 의 `texts` 상한 */
const SOURCE_TEXTS_LIMIT = 1000

const DEFAULT_TIMEOUT_MS = 30_000

/** 이관·되돌리기는 항목 수천 건을 한 트랜잭션으로 적용하므로 일반 요청보다 오래 기다린다 */
const KEY_MIGRATION_TIMEOUT_MS = 10 * 60_000

export class L10nStorageApiClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const url = `${this.baseUrl}${path}`
    log.verbose('l10n-storage-api', `${method} ${url}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          [SYNCER_VERSION_HEADER]: SYNCER_VERSION,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) {
      const text = await res.text()
      if (res.status === 426) {
        const upgradeRequired = parseUpgradeRequired(text)
        if (upgradeRequired) {
          log.error('l10n-storage', upgradeRequired.message)
          throw upgradeRequired
        }
      }
      if (res.status === 400) {
        const migrationInvalid = parseKeyMigrationInvalid(text)
        if (migrationInvalid) {
          throw migrationInvalid
        }
      }
      throw new L10nStorageApiError(res.status, `L10n Storage API error: ${res.status} ${res.statusText} - ${text}`)
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
      const params = new URLSearchParams({ limit: '5000' })
      if (cursor) params.set('cursor', cursor)
      const response = await this.request<ListKeysToServeResponse>(
        'GET',
        `/api/l10n/projects/${projectId}/keys-to-serve?${params.toString()}`,
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
      const params = new URLSearchParams({ limit: '5000' })
      if (cursor) params.set('cursor', cursor)
      if (source) params.set('source', source)
      const response = await this.request<ListKeysToServeResponse>(
        'GET',
        `/api/l10n/projects/${projectId}/tags/${encodedTag}/keys-to-serve?${params.toString()}`,
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

  /**
   * 태그의 키 방식을 조회한다. 설정하지 않은 태그는 서버가 `source` 를 반환한다.
   * 공용 키 계약 이전 서버에는 이 엔드포인트가 없어 404 가 반환되므로 `source` 로 간주한다.
   * 프로젝트가 없어서 404 인 경우는 이어지는 키 조회가 같은 오류로 실패한다.
   */
  async getTagSyncSettings(projectId: string, tag: string): Promise<L10nTagSyncSettings> {
    try {
      return await this.request<L10nTagSyncSettings>(
        'GET',
        `/api/l10n/projects/${projectId}/tags/${encodeURIComponent(tag)}/sync-settings`,
      )
    } catch (err) {
      if (err instanceof L10nStorageApiError && err.status === 404) {
        log.verbose('l10n-storage-api', `sync-settings not found for tag ${tag}, assuming keyMode=source`)
        return { tag, keyMode: 'source', minSyncerVersion: null }
      }
      throw err
    }
  }

  /** 원문이 정확히 일치하는 키를 조회한다. 결과는 `input.texts` 순서와 같다 */
  async findKeysBySourceTexts(projectId: string, input: FindKeysBySourceTextsInput): Promise<L10nSourceTextMatchResult[]> {
    const results: L10nSourceTextMatchResult[] = []
    for (const texts of chunk(input.texts, SOURCE_TEXTS_LIMIT)) {
      const response = await this.request<FindKeysBySourceTextsResponse>(
        'POST',
        `/api/l10n/projects/${projectId}/keys/by-source-texts`,
        { ...input, texts },
      )
      results.push(...response.results)
    }
    return results
  }

  /**
   * 원문 키를 공용 키로 이관한다. dry-run 이 아닌 요청에 계획 오류가 있으면 {@link L10nKeyMigrationInvalidError} 가
   * 발생하며 서버는 아무것도 기록하지 않는다.
   */
  async migrateKeys(projectId: string, input: L10nKeyMigrationInput): Promise<L10nKeyMigrationResponse> {
    return await this.request<L10nKeyMigrationResponse>(
      'POST',
      `/api/l10n/projects/${projectId}/key-migrations`,
      input,
      KEY_MIGRATION_TIMEOUT_MS,
    )
  }

  /** 적용한 이관을 서버가 저장한 되돌리기 계획으로 되돌린다 */
  async rollbackKeyMigration(projectId: string, input: L10nKeyMigrationRollbackInput): Promise<L10nKeyMigrationRollbackResponse> {
    return await this.request<L10nKeyMigrationRollbackResponse>(
      'POST',
      `/api/l10n/projects/${projectId}/key-migrations/rollback`,
      input,
      KEY_MIGRATION_TIMEOUT_MS,
    )
  }

  async createKeys(projectId: string, keys: CreateL10nKeyInput[]): Promise<void> {
    await this.request('POST', `/api/l10n/projects/${projectId}/keys`, { keys })
  }

  async updateKeys(projectId: string, keys: UpdateL10nKeyInput[]): Promise<void> {
    await this.request('PUT', `/api/l10n/projects/${projectId}/keys`, { keys })
  }
}

/** rc 설정의 l10n-storage 프로젝트에 `TPC_AGENT_TOKEN` 으로 접속하는 클라이언트 */
export function createApiClient(config: L10nConfig): { apiClient: L10nStorageApiClient, projectId: string } {
  const storageConfig = config.getL10nStorageConfig()
  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN environment variable is required')
  }
  return {
    apiClient: new L10nStorageApiClient(storageConfig.getUrl(), token),
    projectId: storageConfig.getProjectId(),
  }
}
