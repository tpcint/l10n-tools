import { KeyExtractor } from 'l10n-tools-core'
import { extractAndroidStringsXml } from './extractor.js'

/**
 * Compare old and new Android strings.xml content and return changed/added contexts.
 * Deleted keys are excluded since they don't need translation checks.
 */
export function diffAndroidKeys(oldContent: string, newContent: string, filename: string, module?: string): string[] {
  const oldExtractor = new KeyExtractor()
  const newExtractor = new KeyExtractor()

  if (oldContent) {
    extractAndroidStringsXml(oldExtractor, filename, oldContent, 1, module)
  }
  extractAndroidStringsXml(newExtractor, filename, newContent, 1, module)

  const oldMap = new Map<string, string>()
  for (const entry of oldExtractor.keys.toEntries()) {
    if (entry.context != null) {
      oldMap.set(entry.context, entry.key)
    }
  }

  const changed: string[] = []
  for (const entry of newExtractor.keys.toEntries()) {
    if (entry.context == null) continue
    const oldKey = oldMap.get(entry.context)
    if (oldKey == null || oldKey !== entry.key) {
      changed.push(entry.context)
    }
  }

  return changed
}
