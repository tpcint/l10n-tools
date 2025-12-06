import { spawn } from 'child_process'
import commandExists from 'command-exists'
import log from 'npmlog'
import os from 'node:os'
import fsp from 'node:fs/promises'
import path from 'path'
import { glob } from 'tinyglobby'

export function execWithLog(cmd: string, logPrefix: string = ''): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, [], { shell: true })

    p.stdout.on('data', data => {
      for (const line of data.toString().split('\n')) {
        if (line) {
          log.info(logPrefix, line)
        }
      }
    })

    p.stderr.on('data', data => {
      for (const line of data.toString().split('\n')) {
        if (line) {
          log.warn(logPrefix, line)
        }
      }
    })

    p.on('close', code => {
      if (code === 0) {
        resolve(code)
      } else {
        reject(new Error(`process exited with code '${code}': ${cmd}`))
      }
    })
  })
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath)
    return true
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return false
    }
    throw err
  }
}

export function isErrnoException(err: unknown, code?: string): err is NodeJS.ErrnoException {
  if (typeof err === 'object' && err != null && 'errno' in err && 'code' in err) {
    return code == null || err.code == code
  } else {
    return false
  }
}

export const requireCmd = {
  brew: requireBrewCmd,
}

async function requireBrewCmd(cmd: string, pkg: string, needForceLink: boolean = false): Promise<void> {
  try {
    await commandExists(cmd)
  } catch (err) {
    if (needForceLink) {
      throw new Error(`install '${cmd}' by 'brew install ${pkg} && brew link --force ${pkg}' or else you like`, { cause: err })
    } else {
      throw new Error(`install '${cmd}' by 'brew install ${pkg}' or else you like`, { cause: err })
    }
  }
}

export function getTempDir(): string {
  return path.join(os.tmpdir(), process.pid.toString())
}

export function sortSet<T>(set: Set<T>, compareFn?: (a: T, b: T) => number): T[] {
  return Array.from(set).sort(compareFn)
}

export function addToArraySet<T>(array: T[], value: T): T[] {
  const set = new Set(array)
  set.add(value)
  return [...set]
}

export function removeFromArraySet<T>(array: T[], value: T): T[] {
  const set = new Set(array)
  set.delete(value)
  return [...set]
}

export async function listTransPaths(transDir: string): Promise<string[]> {
  return await glob(`${transDir}/trans-*.json`)
}

export function extractLocaleFromTransPath(transPath: string): string {
  return path.basename(transPath, '.json').substring(6)
}

export function getKeysPath(keysDir: string): string {
  return path.join(keysDir, 'keys.json')
}

export function getTransPath(transDir: string, locale: string): string {
  return path.join(transDir, `trans-${locale}.json`)
}

export function isPureKey(keyName: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => keyName.startsWith(prefix))
}
