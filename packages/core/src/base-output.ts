import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import log from 'npmlog'
import type { CompilerConfig } from './config.js'
import { getTempDir } from './utils.js'

const execFileAsync = promisify(execFile)

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

async function gitBlob(args: string[], cwd: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    return stdout
  } catch {
    return null
  }
}

async function getRepoRoot(): Promise<string | null> {
  const stdout = await git(['rev-parse', '--show-toplevel'], process.cwd())
  return stdout == null ? null : await realPath(stdout.trim())
}

/**
 * `fsp.realpath` that tolerates a path that does not exist yet by resolving the deepest
 * existing ancestor. Both sides of the repo-relative comparison must go through this:
 * git reports physical paths, so a checkout reached through a symlink (`/tmp` on macOS,
 * a symlinked home) would otherwise look like it sits outside the repository.
 */
async function realPath(target: string): Promise<string> {
  try {
    return await fsp.realpath(target)
  } catch {
    const parent = path.dirname(target)
    if (parent === target) {
      return target
    }
    return path.join(await realPath(parent), path.basename(target))
  }
}

/**
 * The commit whose compiled output this branch inherited, or `null` when it cannot be
 * determined (no explicit ref and no reachable default branch, a shallow clone, or no
 * git at all).
 *
 * `explicit` comes from `--source-base`, and `L10N_SOURCE_BASE` is the same input by
 * environment. CI needs the environment form: a workflow reaches every repo the moment it
 * merges while l10n-tools arrives only when each repo's lockfile is bumped, so a bare
 * `--source-base` on the command line would break every repo still on an older version.
 * An unset variable expands to an empty string in CI, which counts as "not given".
 *
 * The fallback probes the merge base with the remote's default branch, which covers
 * ordinary local runs but relies on `origin/HEAD` being set.
 */
export async function resolveBaseRef(explicit?: string): Promise<string | null> {
  const cwd = process.cwd()
  const requested = explicit || process.env.L10N_SOURCE_BASE || undefined
  if (requested != null) {
    const resolved = await git(['rev-parse', '--verify', '--quiet', `${requested}^{commit}`], cwd)
    if (resolved == null) {
      log.warn('base-output', `base ref '${requested}' is not available in this checkout`)
      return null
    }
    return resolved.trim()
  }
  const mergeBase = await git(['merge-base', 'HEAD', 'origin/HEAD'], cwd)
  return mergeBase == null ? null : mergeBase.trim()
}

/**
 * Copies each output's target location out of `baseRef` into a temp tree and returns
 * configs pointing at that copy, in the same order as `configs`.
 *
 * Reading the base output — rather than the working tree — is what makes the `--source`
 * scope stable: the scope must not change just because a previous compile wrote some of
 * the keys, otherwise a key drops out of scope after the first partial apply and the
 * translations that arrive later never reach the branch.
 *
 * Returns `null` when the base output cannot be materialized at all (not a git repo, an
 * output writing outside the repo, or git refusing to read the base tree); callers then
 * fall back to the working tree. An output that simply does not exist in `baseRef` is not
 * a failure — it yields an empty copy, which is exactly "every key of this output is new".
 */
export async function materializeBaseOutputs(
  configs: CompilerConfig[],
  baseRef: string,
): Promise<{ configs: CompilerConfig[], cleanup: () => Promise<void> } | null> {
  const repoRoot = await getRepoRoot()
  if (repoRoot == null) {
    return null
  }

  const locations = configs.flatMap(config => config.getTargetLocations())
  const relByLocation = new Map<string, string>()
  for (const location of locations) {
    const rel = path.relative(repoRoot, await realPath(path.resolve(location)))
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      log.warn('base-output', `output location '${location}' is outside the repository`)
      return null
    }
    relByLocation.set(location, rel)
  }

  const baseDir = getTempDir()
  await fsp.mkdir(baseDir, { recursive: true })
  const tempRoot = await fsp.mkdtemp(path.join(baseDir, 'base-output-'))
  const cleanup = async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true })
  }

  try {
    for (const rel of relByLocation.values()) {
      if (!await checkoutTreePath(baseRef, rel, repoRoot, tempRoot)) {
        await cleanup()
        return null
      }
    }
  } catch (err) {
    await cleanup()
    throw err
  }

  return {
    configs: configs.map(config => config.withRewrittenTargets(
      location => path.join(tempRoot, relByLocation.get(location)!),
    )),
    cleanup,
  }
}

/**
 * Writes every blob under `rel` in `baseRef` into `tempRoot`, keeping the same layout, and
 * reports whether git answered for the whole path.
 *
 * `false` must not be read as "the base has no such path": an empty copy means "every key
 * of this output is new", so a git failure left unreported would pull the entire local
 * extraction into scope. A path that is genuinely absent from `baseRef` lists no files and
 * still succeeds.
 */
async function checkoutTreePath(baseRef: string, rel: string, repoRoot: string, tempRoot: string): Promise<boolean> {
  const relPosix = rel.split(path.sep).join(path.posix.sep)
  // An output location is a literal path. Without `--literal-pathspecs` a glob character
  // in it (`*`, `?`, `[`) is matched as a pattern, which lists nothing and exits zero.
  const listed = await git(
    ['--literal-pathspecs', 'ls-tree', '-r', '-z', '--name-only', baseRef, '--', relPosix],
    repoRoot,
  )
  if (listed == null) {
    log.warn('base-output', `cannot list '${relPosix}' in '${baseRef}'`)
    return false
  }
  for (const file of listed.split('\0').filter(Boolean)) {
    const blob = await gitBlob(['show', `${baseRef}:${file}`], repoRoot)
    if (blob == null) {
      // The tree named this blob, so a read failure is a broken object store (a partial
      // clone that filtered blobs out, most likely), not an absent file.
      log.warn('base-output', `cannot read '${file}' from '${baseRef}'`)
      return false
    }
    const destPath = path.join(tempRoot, ...file.split(path.posix.sep))
    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    await fsp.writeFile(destPath, blob)
  }
  return true
}
