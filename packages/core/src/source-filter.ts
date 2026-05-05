import fsp from 'node:fs/promises'
import path from 'node:path'
import { type TransEntry, writeTransEntries } from './entry.js'
import type { SyncerKeySnapshot } from './plugin-types.js'
import { getTempDir, getTransPath } from './utils.js'

/**
 * Write trans-{locale}.json files representing the given snapshots into a fresh
 * temp directory and return its path. Used by `_compile --source` to compile a
 * subset of keys without mutating the local cache.
 *
 * Caller is responsible for cleaning up the returned directory.
 */
export async function materializeSnapshotsToTempDir(
  domainName: string,
  snapshots: SyncerKeySnapshot[],
  locales: string[],
): Promise<string> {
  const tempDir = path.join(getTempDir(), `compile-source-${Date.now()}-${domainName}`)
  await fsp.mkdir(tempDir, { recursive: true })

  for (const locale of locales) {
    const entries: TransEntry[] = []
    for (const snapshot of snapshots) {
      const messages = snapshot.translations[locale] ?? {}
      const contexts = snapshot.contexts.length > 0 ? snapshot.contexts : [null]
      for (const context of contexts) {
        entries.push({
          context,
          key: snapshot.keyName,
          messages,
          flag: null,
        })
      }
    }
    await writeTransEntries(getTransPath(tempDir, locale), entries)
  }

  return tempDir
}
