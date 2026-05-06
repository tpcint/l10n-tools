#!/usr/bin/env node

import { Command } from 'commander'
import log from 'npmlog'
import {
  checkTransEntrySpecs,
  compileAll,
  type DomainConfig,
  EntryCollection,
  extractKeys,
  fileExists,
  getKeysPath,
  getTransPath,
  L10nConfig,
  materializeSnapshotsToTempDir,
  pluginRegistry,
  type ProgramOptions,
  readKeyEntries,
  readTransEntries,
  type SyncerKeySnapshot,
  type SyncerOptions,
  syncTransToTarget,
  type TransEntry,
  updateTrans,
} from 'l10n-tools-core'
import * as path from 'path'
import fsp from 'node:fs/promises'
import { cosmiconfig } from 'cosmiconfig'
import { fileURLToPath } from 'url'
import { Ajv } from 'ajv'

const program = new Command('l10n-tools')
const dirname = path.dirname(fileURLToPath(import.meta.url))

function collectKeyValue(value: string, previous: Record<string, string>): Record<string, string> {
  const eqIdx = value.indexOf('=')
  if (eqIdx < 1) {
    throw new Error(`Invalid key=value format: ${value}`)
  }
  previous[value.substring(0, eqIdx)] = value.substring(eqIdx + 1)
  return previous
}

function buildSyncerOptions(opts: { tags?: string, metadata?: Record<string, string>, tagMetadata?: Record<string, string>, source?: string }): SyncerOptions {
  return {
    additionalTags: opts.tags ? opts.tags.split(',') : undefined,
    globalMetadata: opts.metadata && Object.keys(opts.metadata).length > 0 ? opts.metadata : undefined,
    tagMetadata: opts.tagMetadata && Object.keys(opts.tagMetadata).length > 0 ? opts.tagMetadata : undefined,
    source: opts.source,
  }
}

async function fetchSourceSnapshots(
  cmdName: string,
  config: L10nConfig,
  domainConfig: DomainConfig,
  source: string,
): Promise<SyncerKeySnapshot[]> {
  const syncTarget = config.getSyncTarget()
  const sourceFilter = pluginRegistry.getSourceFilter(syncTarget)
  if (!sourceFilter) {
    log.error(cmdName, `--source is not supported by sync target '${syncTarget}'`)
    process.exit(1)
  }
  return await sourceFilter(config, domainConfig, domainConfig.getTag(), source)
}

/**
 * Compile a source-scoped subset of keys into the existing target file(s) by merging
 * the snapshot output on top of the current output. Used by both `sync --source` and
 * `_compile --source` so the merge semantics stay identical between the two paths.
 */
async function compileFromSource(
  cmdName: string,
  config: L10nConfig,
  domainConfig: DomainConfig,
  domainName: string,
  source: string,
): Promise<void> {
  const snapshots = await fetchSourceSnapshots(cmdName, config, domainConfig, source)
  const mergeKeys = new Set(snapshots.map(s => s.keyName))
  const tempDir = await materializeSnapshotsToTempDir(domainName, snapshots, domainConfig.getLocales())
  try {
    await compileAll(domainName, domainConfig, tempDir, { mergeKeys })
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
}

/**
 * Configure the CLI, register l10n commands and options, and parse process arguments.
 *
 * Sets up global options and commands (update, upload, sync, check and internal helpers),
 * wires each command to its domain-aware action handlers, and invokes argument parsing.
 */
async function run() {
  // Initialize plugin registry - discovers and loads all installed plugins
  await pluginRegistry.initialize()

  const pkg = JSON.parse(await fsp.readFile(path.join(dirname, '..', 'package.json'), { encoding: 'utf-8' }))
  program.version(pkg.version)
    .description(pkg.description)
    .option('-r, --rcfile <rcfile>', 'specify config file, default to .l10nrc')
    .option('-d, --domains <domains>', 'specify domains to apply, if not specified, all domains in config file (comma separated)', val => val.split(','))
    .option('-s, --skip-validation', 'skip format validation')
    .option('-b, --validation-base-locale <locale>', 'use msgstr of locale as validation base, default to msgid')
    .option('-n, --dry-sync', 'skip actual sync')
    .option('-v, --verbose', 'log verbose')
    .option('-q, --quiet', 'be quiet')
    .on('--help', () => {
      console.info('\nRC file:\n  refer to [L10nConf] type or see \'l10nrc.schema.json\'')
    })

  program.command('plugins')
    .description('List installed plugins')
    .action(async () => {
      for (const plugin of pluginRegistry.getPlugins().values()) {
        const caps: string[] = []
        if (plugin.extractors?.length) {
          caps.push('extractors: ' + plugin.extractors.flatMap(e => e.domainTypes).join(', '))
        }
        if (plugin.compilers?.length) {
          caps.push('compilers: ' + plugin.compilers.flatMap(c => Object.keys(c.compilers)).join(', '))
        }
        if (plugin.syncers?.length) {
          caps.push('syncers: ' + plugin.syncers.map(s => s.syncTarget).join(', '))
        }
        console.log(`${plugin.name}\t${caps.join('\t')}`)
      }
    })

  program.command('update')
    .description('Update local translations')
    .action(async (opts, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = domainConfig.getLocales()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        await compileAll(domainName, domainConfig, transDir)
      })
    })

  type UploadOptions = {
    tags?: string,
    metadata?: Record<string, string>,
    tagMetadata?: Record<string, string>,
    source?: string,
  }
  program.command('upload')
    .description('Upload local changes to sync target (local files will not touched)')
    .option('-t, --tags <tags>', 'additional tags to apply when creating keys (comma separated)')
    .option('-m, --metadata <key=value>', 'global metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--tag-metadata <key=value>', 'tag-specific metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--source <source>', 'source identifier for tag ownership (l10n-storage)')
    .action(async (opts: UploadOptions, cmd: Command) => {
      const syncerOptions = buildSyncerOptions(opts)
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, skipUpload) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, syncerOptions, true)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)
      })
    })

  program.command('download')
    .description('Download translations from sync target to local cache')
    .action(async (_opts, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, true)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)
      })
    })

  type SyncOptions = {
    tags?: string,
    metadata?: Record<string, string>,
    tagMetadata?: Record<string, string>,
    source?: string,
  }
  program.command('sync')
    .description('Synchronize local translations and sync target')
    .option('-t, --tags <tags>', 'additional tags to apply when creating keys (comma separated)')
    .option('-m, --metadata <key=value>', 'global metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--tag-metadata <key=value>', 'tag-specific metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--source <source>', 'source identifier for tag ownership (l10n-storage)')
    .action(async (opts: SyncOptions, cmd: Command) => {
      const syncerOptions = buildSyncerOptions(opts)
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, skipUpload) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, syncerOptions)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        if (opts.source) {
          await compileFromSource(cmd.name(), config, domainConfig, domainName, opts.source)
        } else {
          await compileAll(domainName, domainConfig, transDir)
        }
      })
    })

  type CheckOptions = {
    locales?: string,
    forceSync?: boolean,
    tags?: string,
    metadata?: Record<string, string>,
    tagMetadata?: Record<string, string>,
    source?: string,
    contexts?: string,
  }
  program.command('check')
    .description('Check all translated')
    .option('-l, --locales [locales]', 'locales to check, all if not specified (comma separated)')
    .option('--force-sync', 'sync even if translations are cached')
    .option('-t, --tags <tags>', 'additional tags to apply when creating keys (comma separated)')
    .option('-m, --metadata <key=value>', 'global metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--tag-metadata <key=value>', 'tag-specific metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--source <source>', 'source identifier for tag ownership (l10n-storage)')
    .option('-c, --contexts <contexts>', 'contexts to check (comma separated)')
    .argument('[files...]', 'files to check, if not specified, all files will be checked')
    .action(async (files: string[], opts: CheckOptions, cmd: Command) => {
      const syncerOptions = buildSyncerOptions(opts)
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, skipUpload) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = opts['locales'] ? opts['locales'].split(',') : domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const specs = ['untranslated']
        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        if (opts['forceSync']) {
          log.warn(cmd.name(), '--force-sync is deprecated. Run \'l10n download\' before \'l10n check\' instead.')
        }
        if (opts['forceSync'] || !await fileExists(transDir)) {
          await updateTrans(keysPath, transDir, transDir, locales, null)
          await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, syncerOptions)
        }
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        const keys = await (async () => {
          const fileSet = new Set<string>(files)
          const contextSet = opts.contexts !== undefined
            ? new Set<string>(opts.contexts.split(',').filter(Boolean))
            : null
          const sourceKeyNameSet = opts.source
            ? new Set((await fetchSourceSnapshots(cmd.name(), config, domainConfig, opts.source)).map(s => s.keyName))
            : null

          if (fileSet.size === 0 && contextSet == null && sourceKeyNameSet == null) {
            return null
          }

          const fileOrContextActive = fileSet.size > 0 || contextSet != null
          const keyEntries = (await readKeyEntries(keysPath))
            .filter(keyEntry => {
              if (sourceKeyNameSet != null && !sourceKeyNameSet.has(keyEntry.key)) {
                return false
              }
              if (!fileOrContextActive) {
                return true
              }
              const matchesFile = fileSet.size > 0
                && keyEntry.references.some(ref => fileSet.has(ref.file))
              const matchesContext = contextSet != null
                && keyEntry.context != null && contextSet.has(keyEntry.context)
              return matchesFile || matchesContext
            })
          if (sourceKeyNameSet != null && keyEntries.length === 0) {
            log.warn(cmd.name(), `no local keys matched source '${opts.source}' (run 'l10n update' or 'l10n sync' to refresh local keys)`)
          }
          return EntryCollection.loadEntries(keyEntries)
        })()
        for (const locale of locales) {
          const transPath = getTransPath(transDir, locale)
          const useUnverified = config.useUnverified(locale)
          for (const transEntry of await readTransEntries(transPath)) {
            // keys 에 없는 엔트리는 스킵
            if (keys != null && keys.find(transEntry.context, transEntry.key) == null) {
              continue
            }
            if (!checkTransEntrySpecs(transEntry, specs, useUnverified)) {
              continue
            }
            process.exitCode = 1

            process.stdout.write(`[${locale}] ${specs.join(',')}\n`)
            const flag = transEntry.flag
            if (flag) {
              process.stdout.write(`#, ${flag}\n`)
            }
            if (transEntry.context) {
              process.stdout.write(`context "${transEntry.context.replace(/\n/g, '\\n')}"\n`)
            }
            process.stdout.write(`key     "${transEntry.key.replace(/\n/g, '\\n')}"\n`)
            process.stdout.write(`message "${JSON.stringify(transEntry.messages)}"\n\n`)
          }
        }
      })
    })

  type ExtractKeysOptions = {
    keysDir?: string,
  }
  program.command('_extractKeys')
    .description('Extract key entries from source and saved to files (internal use only)')
    .option('--keys-dir [keysDir]', 'directory to save key files')
    .action(async (opts: ExtractKeysOptions, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const cacheDir = opts['keysDir'] || domainConfig.getCacheDir()
        const keysPath = getKeysPath(path.join(cacheDir, domainName))

        await extractKeys(domainName, domainConfig, keysPath)
      })
    })

  type UpdateTransOptions = {
    locales?: string,
    keysDir?: string,
    transDir?: string,
  }
  program.command('_updateTrans')
    .description('Apply key changes to translations (internal use only)')
    .option('-l, --locales [locales]', 'locales to update (comma separated)')
    .option('--keys-dir [keysDir]', 'directory to load key files')
    .option('--trans-dir [transDir]', 'directory to save translation files')
    .action(async (opts: UpdateTransOptions, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = opts['locales'] ? opts['locales'].split(',') : domainConfig.getLocales()
        config.getValidationConfig(program.opts<ProgramOptions>())
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(opts['keysDir'] || cacheDir, domainName))
        const fromTransDir = path.join(cacheDir, domainName)
        const transDir = path.join(opts['transDir'] || cacheDir, domainName)

        await updateTrans(keysPath, fromTransDir, transDir, locales, validationConfig)
      })
    })

  type CountOptions = {
    transDir?: string,
    locales?: string,
    spec?: string,
  }
  program.command('_count')
    .description('Count translations (internal use only)')
    .option('--trans-dir [transDir]', 'directory to load translation files')
    .option('-l, --locales [locales]', 'locales to count (comma separated)')
    .option('--spec [spec]', 'spec to count (required, negate if starting with !, comma separated) supported: total,translated,untranslated,<flag>')
    .action(async (opts: CountOptions, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales: string[] = opts['locales'] ? opts['locales'].split(',') : domainConfig.getLocales()
        const specs = opts['spec'] ? opts['spec'].split(',') : ['total']

        const transDir = path.join(opts['transDir'] || cacheDir, domainName)
        const counts: string[] = []
        for (const locale of locales) {
          const transPath = getTransPath(transDir, locale)
          const useUnverified = config.useUnverified(locale)
          let count = 0
          for (const transEntry of await readTransEntries(transPath)) {
            if (checkTransEntrySpecs(transEntry, specs, useUnverified)) {
              count++
            }
          }
          counts.push(locale + ':' + count)
        }
        process.stdout.write(`${domainName},${counts.join(',')}\n`)
      })
    })

  type RemoteCountOptions = {
    locales?: string,
    spec?: string,
    source?: string,
  }
  program.command('_remoteCount')
    .description('Count remote translations from sync target (internal use only)')
    .option('-l, --locales [locales]', 'locales to count (comma separated)')
    .option('--spec [spec]', 'spec to count (required, negate if starting with !, comma separated) supported: total,translated,untranslated')
    .option('--source <source>', 'source identifier to filter (l10n-storage); omit to count all keys for the tag')
    .action(async (opts: RemoteCountOptions, cmd: Command) => {
      const supportedSpecs = new Set(['total', 'translated', 'untranslated'])
      const specs = opts['spec'] ? opts['spec'].split(',') : ['total']
      const invalidSpecs = specs.filter(s => !supportedSpecs.has(s.startsWith('!') ? s.slice(1) : s))
      if (invalidSpecs.length > 0) {
        log.error(cmd.name(), `unsupported spec(s): ${invalidSpecs.join(',')}; supported: ${[...supportedSpecs].join(', ')}`)
        process.exit(1)
      }

      const isAggregate = !program.opts<ProgramOptions>()['domains']
      const aggregate = new Map<string, number>()

      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const syncTarget = config.getSyncTarget()
        const sourceFilter = pluginRegistry.getSourceFilter(syncTarget)
        if (!sourceFilter) {
          log.error(cmd.name(), `sync target '${syncTarget}' does not support remote listing`)
          process.exit(1)
        }

        const tag = domainConfig.getTag()
        const locales: string[] = opts['locales'] ? opts['locales'].split(',') : domainConfig.getLocales()

        const snapshots = await sourceFilter(config, domainConfig, tag, opts.source)

        const counts: string[] = []
        for (const locale of locales) {
          const useUnverified = config.useUnverified(locale)
          let count = 0
          for (const snapshot of snapshots) {
            const messages = snapshot.translations[locale] ?? {}
            for (const context of snapshot.contexts) {
              const transEntry: TransEntry = {
                context,
                key: snapshot.keyName,
                messages,
                flag: null,
              }
              if (checkTransEntrySpecs(transEntry, specs, useUnverified)) {
                count++
              }
            }
          }
          if (isAggregate) {
            aggregate.set(locale, (aggregate.get(locale) ?? 0) + count)
          } else {
            counts.push(locale + ':' + count)
          }
        }
        if (!isAggregate) {
          process.stdout.write(`${domainName},${counts.join(',')}\n`)
        }
      })

      if (isAggregate) {
        const counts = [...aggregate.entries()].map(([l, c]) => `${l}:${c}`)
        process.stdout.write(`*,${counts.join(',')}\n`)
      }
    })

  type CatOptions = {
    transDir?: string,
    locale?: string,
    spec?: string,
  }
  program.command('_cat')
    .description('Print translation entries (internal use only)')
    .option('--trans-dir [transDir]', 'directory to read translations')
    .option('-l, --locale [locale]', 'locale to print (required)')
    .option('--spec [spec]', 'spec to print (required, negate if starting with !, comma separated) supported: total,translated,untranslated,<flag>')
    .action(async (opts: CatOptions, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        if (!opts['locale']) {
          cmd.help()
        }

        const cacheDir = domainConfig.getCacheDir()
        const locale = opts['locale']
        const specs = opts['spec'] ? opts['spec'].split(',') : ['total']

        const transDir = path.join(opts['transDir'] || cacheDir, domainName)
        const transPath = getTransPath(transDir, locale)

        const useUnverified = config.useUnverified(locale)
        for (const transEntry of await readTransEntries(transPath)) {
          if (!checkTransEntrySpecs(transEntry, specs, useUnverified)) {
            continue
          }

          const flag = transEntry.flag
          if (flag) {
            process.stdout.write(`#, ${flag}\n`)
          }
          if (transEntry.context) {
            process.stdout.write(`context "${transEntry.context.replace(/\n/g, '\\n')}"\n`)
          }
          process.stdout.write(`key     "${transEntry.key.replace(/\n/g, '\\n')}"\n`)
          process.stdout.write(`message "${JSON.stringify(transEntry.messages)}"\n\n`)
        }
      })
    })

  type CompileCmdOptions = {
    source?: string,
  }
  program.command('_compile')
    .description('Write domain asset from translations (internal use only)')
    .option('--source <source>', 'compile only keys belonging to this source (l10n-storage only)')
    .action(async (opts: CompileCmdOptions, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        if (opts.source) {
          await compileFromSource(cmd.name(), config, domainConfig, domainName, opts.source)
          return
        }
        const cacheDir = domainConfig.getCacheDir()
        const transDir = path.join(cacheDir, domainName)
        await compileAll(domainName, domainConfig, transDir)
      })
    })

  type InternalSyncOptions = {
    tags?: string,
    metadata?: Record<string, string>,
    tagMetadata?: Record<string, string>,
    source?: string,
  }
  program.command('_sync')
    .description('Synchronize translations to remote target (internal use only)')
    .option('-t, --tags <tags>', 'additional tags to apply when creating keys (comma separated)')
    .option('-m, --metadata <key=value>', 'global metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--tag-metadata <key=value>', 'tag-specific metadata to apply when creating keys (repeatable)', collectKeyValue, {})
    .option('--source <source>', 'source identifier for tag ownership (l10n-storage)')
    .action(async (opts: InternalSyncOptions, cmd: Command) => {
      const syncerOptions = buildSyncerOptions(opts)
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, skipUpload) => {
        const tag = domainConfig.getTag()
        const cacheDir = domainConfig.getCacheDir()

        const transDir = path.join(cacheDir, domainName)
        const keysPath = getKeysPath(path.join(cacheDir, domainName))

        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, syncerOptions)
      })
    })

  program.parse(process.argv)
}

async function runSubCommand(cmdName: string, action: (domainName: string, config: L10nConfig, domainConfig: DomainConfig, skipUpload: boolean) => Promise<void>) {
  log.heading = cmdName

  const globalOpts = program.opts<ProgramOptions>()
  if (globalOpts['verbose']) {
    log.level = 'silly'
  } else if (globalOpts['quiet']) {
    log.level = 'warn'
  }

  const config = await loadConfig(globalOpts['rcfile'] || '.l10nrc')
  const domainNames = globalOpts['domains'] || config.getDomainNames()
  const skipUpload = globalOpts['drySync'] || false
  if (skipUpload) {
    log.warn(cmdName, '--dry-sync is deprecated. Use \'l10n download\' instead of \'l10n -n sync\'.')
  }

  for (const domainName of domainNames) {
    const domainConfig = config.getDomainConfig(domainName)
    if (domainConfig == null) {
      log.error(cmdName, `no config found for domain ${domainName}`)
      process.exit(1)
    }
    log.heading = `[${domainName}] ${cmdName}`
    await action(domainName, config, domainConfig, skipUpload)
  }
}

async function loadConfig(rcPath: string): Promise<L10nConfig> {
  const explorer = cosmiconfig('l10n')
  const rc = await explorer.load(rcPath)
  const ajv = new Ajv()

  // Load schema from l10n-tools-core package
  const corePackagePath = import.meta.resolve('l10n-tools-core')
  const coreDir = path.dirname(fileURLToPath(corePackagePath))
  const schemaPath = path.join(coreDir, '..', 'l10nrc.schema.json')
  const schema = JSON.parse(await fsp.readFile(schemaPath, { encoding: 'utf-8' }))

  const validate = ajv.compile(schema)
  const valid = validate(rc?.config)
  if (!valid) {
    log.error('l10n', 'rc file error', validate.errors)
    throw new Error('rc file is not valid')
  }
  return new L10nConfig(rc?.config)
}

try {
  await run()
} catch (err) {
  log.error('l10n', 'run failed', err)
  process.exit(1)
}
