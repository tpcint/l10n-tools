import { DomainConfig, L10nConfig } from 'l10n-tools-core'

export const API_BASE = process.env.TPC_AGENT_URL ?? 'http://localhost:5100'

function requireToken(): string {
  const token = process.env.TPC_AGENT_TOKEN
  if (!token) {
    throw new Error('TPC_AGENT_TOKEN env var is required for e2e tests (see packages/syncer-l10n-storage/.env.example)')
  }
  return token
}

export const DEV_TOKEN = requireToken()

export async function api<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/l10n${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEV_TOKEN}`,
      ...options?.headers,
    },
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.text()
    throw new Error(`API ${path} failed: ${res.status} ${body}`)
  }
  if (res.status === 204) return undefined as T
  return await res.json() as T
}

export async function isL10nApiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/l10n/locales`, {
      headers: { Authorization: `Bearer ${DEV_TOKEN}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export interface CreatedProject {
  projectId: string,
  projectName: string,
}

export async function createProject(namePrefix: string, locales: string[], sourceLocale = 'en'): Promise<CreatedProject> {
  const projectName = `${namePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { project } = await api<{ project: { id: string } }>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name: projectName, sourceLocale }),
  })
  const projectId = project.id

  await api(`/projects/${projectId}/locales`, {
    method: 'PUT',
    body: JSON.stringify({
      locales: locales.map(locale => ({ locale, assignees: [] })),
    }),
  })

  return { projectId, projectName }
}

export async function deleteProject(projectId: string | undefined): Promise<void> {
  if (!projectId) return
  await api(`/projects/${projectId}`, { method: 'DELETE' }).catch(() => {})
}

export function buildL10nConfig(projectId: string, opts?: {
  source?: string,
  localeSyncMap?: { [locale: string]: string },
}): L10nConfig {
  return new L10nConfig({
    'domains': {
      app: { type: 'typescript', tag: 'web', locales: [], outputs: [] },
    },
    'sync-target': 'l10n-storage',
    'l10n-storage': {
      'url': API_BASE,
      projectId,
      'source': opts?.source,
      'locale-sync-map': opts?.localeSyncMap,
    },
  })
}

export function buildDomainConfig(): DomainConfig {
  return new DomainConfig({
    type: 'typescript',
    tag: 'web',
    locales: [],
    outputs: [],
  })
}
