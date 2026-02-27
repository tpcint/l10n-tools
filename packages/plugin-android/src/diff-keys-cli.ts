#!/usr/bin/env node

import { execSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { diffAndroidKeys } from './diff-keys.js'

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.error('Usage: l10n-android-diff-keys <base-ref> <module> [<module>...]')
    process.exit(1)
  }

  const [baseRef, ...modules] = args
  const allChanged: string[] = []

  for (const module of modules) {
    const srcPath = path.join(module, 'src', 'main', 'res', 'values', 'strings.xml')

    let oldContent = ''
    try {
      oldContent = execSync(`git show ${baseRef}:${srcPath}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      // File doesn't exist in base ref — all keys are new
    }

    let newContent: string
    try {
      newContent = await fsp.readFile(srcPath, { encoding: 'utf-8' })
    } catch {
      // File doesn't exist in current — no keys to check
      continue
    }

    allChanged.push(...diffAndroidKeys(oldContent, newContent, srcPath, module))
  }

  if (allChanged.length > 0) {
    process.stdout.write(allChanged.join(','))
  }
}

try {
  await main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
