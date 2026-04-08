import type { KeyReference } from 'l10n-tools-core'
import type { L10nKeyMetadata } from './api-types.js'

// --- Context ---

export function getContextsFromMetadata(metadata: L10nKeyMetadata[], tag: string): string[] {
  const entry = metadata.find(m => m.tag === tag && m.metaKey === 'context')
  if (!entry) return []
  try {
    return JSON.parse(entry.metaValue) as string[]
  } catch {
    return []
  }
}

export function metadataContainsContext(metadata: L10nKeyMetadata[], tag: string, context: string | null): boolean {
  if (!context) return true
  return getContextsFromMetadata(metadata, tag).includes(context)
}

export function buildContextMetadata(existingMetadata: L10nKeyMetadata[], tag: string, context: string | null): L10nKeyMetadata | null {
  if (!context) return null
  const existing = getContextsFromMetadata(existingMetadata, tag)
  if (existing.includes(context)) return null
  const updated = [...existing, context]
  return { tag, metaKey: 'context', metaValue: JSON.stringify(updated) }
}

export function buildContextMetadataRemoving(existingMetadata: L10nKeyMetadata[], tag: string, context: string | null): L10nKeyMetadata | null {
  if (!context) return null
  const existing = getContextsFromMetadata(existingMetadata, tag)
  const updated = existing.filter(c => c !== context)
  return { tag, metaKey: 'context', metaValue: JSON.stringify(updated) }
}

// --- Description (comments) ---

export function getDescriptionFromMetadata(metadata: L10nKeyMetadata[], tag: string): string[] {
  const entry = metadata.find(m => m.tag === tag && m.metaKey === 'description')
  if (!entry || !entry.metaValue) return []
  return entry.metaValue.split('\n').filter(Boolean)
}

export function metadataContainsDescription(metadata: L10nKeyMetadata[], tag: string, comments: string[]): boolean {
  if (comments.length === 0 || comments.every(c => !c)) return true
  const existing = new Set(getDescriptionFromMetadata(metadata, tag))
  return comments.every(c => !c || existing.has(c))
}

export function buildDescriptionMetadata(tag: string, comments: string[]): L10nKeyMetadata | null {
  const filtered = comments.filter(Boolean)
  if (filtered.length === 0) return null
  return { tag, metaKey: 'description', metaValue: filtered.join('\n') }
}

// --- References ---

export function buildReferencesMetadata(tag: string, references: KeyReference[]): L10nKeyMetadata | null {
  if (references.length === 0) return null
  return { tag, metaKey: 'references', metaValue: JSON.stringify(references) }
}

// --- CLI custom metadata ---

export function buildGlobalMetadata(globalMetadata: Record<string, string>): L10nKeyMetadata[] {
  return Object.entries(globalMetadata).map(([metaKey, metaValue]) => ({
    tag: null,
    metaKey,
    metaValue,
  }))
}

export function buildTagMetadata(tag: string, tagMetadata: Record<string, string>): L10nKeyMetadata[] {
  return Object.entries(tagMetadata).map(([metaKey, metaValue]) => ({
    tag,
    metaKey,
    metaValue,
  }))
}
