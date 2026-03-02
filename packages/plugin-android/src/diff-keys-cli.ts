#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { diffAndroidKeys } from './diff-keys.js'

async function main() {
  const args = process.argv.slice(2)

  // Parse --default-module option
  let defaultModule: string | undefined
  const filteredArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--default-module' && i + 1 < args.length) {
      defaultModule = args[++i]
    } else {
      filteredArgs.push(args[i])
    }
  }

  if (filteredArgs.length < 2) {
    console.error('Usage: l10n-android-diff-keys [--default-module <module>] <base-ref> <module> [<module>...]')
    process.exit(1)
  }

  const [baseRef, ...modules] = filteredArgs
  const allChanged: string[] = []

  for (const module of modules) {
    const fsSrcPath = path.join(module, 'src', 'main', 'res', 'values', 'strings.xml')
    const gitSrcPath = path.posix.join(module, 'src', 'main', 'res', 'values', 'strings.xml')

    let oldContent = ''
    try {
      oldContent = execFileSync('git', ['show', `${baseRef}:${gitSrcPath}`], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      const stderr = String((err as { stderr?: Buffer | string }).stderr ?? '')
      if (!stderr.includes('does not exist') && !stderr.includes('did not match')) {
        throw err
      }
      // File doesn't exist in base ref — all keys are new
    }

    let newContent: string
    try {
      newContent = await fsp.readFile(fsSrcPath, { encoding: 'utf-8' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err
      }
      // File doesn't exist in current — no keys to check
      continue
    }

    allChanged.push(...diffAndroidKeys(oldContent, newContent, fsSrcPath, module, defaultModule))
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
