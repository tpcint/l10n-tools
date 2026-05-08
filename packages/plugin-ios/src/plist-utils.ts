import type { PlistValue } from 'plist'

export function isPlistDict(v: PlistValue): v is { [key: string]: PlistValue } {
  return v !== null
    && typeof v === 'object'
    && !Array.isArray(v)
    && !(v instanceof Date)
    && !(v instanceof Uint8Array)
}
