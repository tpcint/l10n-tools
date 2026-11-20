#!/usr/bin/env node

import './dotenv-bootstrap.js'

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
  type KeyEntry,
  type KeyMode,
  L10nConfig,
  materializeSnapshotsToTempDir,
  overrideL10nStorageProjectId,
  parseL10nConf,
  pluginRegistry,
  type ProgramOptions,
  readKeyEntries,
  readKeyModeRecord,
  readTransEntries,
  removeKeyModeRecord,
  type SyncerKeyMigration,
  type SyncerKeySnapshot,
  type SyncerKeyWarning,
  type SyncerOptions,
  syncTransToTarget,
  type TransEntry,
  updateTrans,
  writeKeyModeRecord,
} from 'l10n-tools-core'
import * as path from 'path'
import fsp from 'node:fs/promises'
import os from 'node:os'
import { cosmiconfig } from 'cosmiconfig'
import { fileURLToPath } from 'url'

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

/**
 * 동기화 대상에 설정된 태그의 키 방식. 추출·컴파일·sync 가 같은 값을 써야 하므로 동기화 대상에 접속하는 명령이
 * 시작할 때 한 번 조회한다. 키 방식 조회를 지원하지 않는 동기화 대상은 `source` 다.
 */
async function resolveKeyMode(config: L10nConfig, domainConfig: DomainConfig): Promise<KeyMode> {
  const resolver = pluginRegistry.getKeyModeResolver(config.getSyncTarget())
  if (!resolver) {
    return 'source'
  }
  const tag = domainConfig.getTag()
  const keyMode = await resolver(config, domainConfig, tag)
  log.info('l10n', `tag ${tag} key mode: ${keyMode}`)
  return keyMode
}

/**
 * keys 파일을 추출하고 그 키 방식을 keys 파일과 같은 디렉토리에 기록한다.
 * 기록은 캐시의 keys·trans 파일이 어느 키 방식인지 나타내므로, keys 파일을 추출하는 경로는 모두 이 함수를 쓰고
 * 캐시를 수정하지 않는 명령은 기록하지 않는다.
 * 추출이나 기록이 실패해도 이전 기록이 새 keys 파일과 함께 남지 않도록 추출 전에 기록을 삭제한다.
 */
async function extractKeysWithRecord(domainName: string, domainConfig: DomainConfig, keysPath: string, keyMode: KeyMode): Promise<void> {
  const keysDir = path.dirname(keysPath)
  await removeKeyModeRecord(keysDir)
  await extractKeys(domainName, domainConfig, keysPath, { keyMode })
  await writeKeyModeRecord(keysDir, domainConfig.getTag(), keyMode)
}

/**
 * 동기화 대상에 접속하지 않는 명령의 키 방식. 캐시의 keys 파일을 추출할 때 기록한 값을 쓰고, 기록이 없으면 `source` 다.
 * 캐시의 keys·trans 파일과 다른 키 방식으로 추출하면 번역이 대응되지 않는다.
 */
async function readRecordedKeyMode(domainName: string, domainConfig: DomainConfig): Promise<KeyMode> {
  const tag = domainConfig.getTag()
  const keyMode = await readKeyModeRecord(path.join(domainConfig.getCacheDir(), domainName), tag)
  if (keyMode == null) {
    log.info('l10n', `tag ${tag} key mode: source (not recorded; run 'l10n download' if the tag uses id keys)`)
    return 'source'
  }
  log.info('l10n', `tag ${tag} key mode: ${keyMode} (recorded when the cached keys were extracted)`)
  return keyMode
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
  keyMode: KeyMode,
): Promise<void> {
  const snapshots = await fetchSourceSnapshots(cmdName, config, domainConfig, source)
  const mergeKeys = new Set(snapshots.map(s => s.keyName))
  const tempDir = await materializeSnapshotsToTempDir(domainName, snapshots, domainConfig.getLocales())
  try {
    await compileAll(domainName, domainConfig, tempDir, { mergeKeys, keyMode })
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

  const pkg = JSON.parse(await fsp.readFile(path.join(dirname, '..', 'package.json'), { encoding: 'utf-8' })) as { version: string, description: string }
  program.version(pkg.version)
    .description(pkg.description)
    .option('-r, --rcfile <rcfile>', 'specify config file, default to .l10nrc')
    .option('-d, --domains <domains>', 'specify domains to apply, if not specified, all domains in config file (comma separated)', val => val.split(','))
    .option('-s, --skip-validation', 'skip format validation')
    .option('-b, --validation-base-locale <locale>', 'use msgstr of locale as validation base, default to msgid')
    .option('-n, --dry-sync', 'skip actual sync')
    .option('-v, --verbose', 'log verbose')
    .option('-q, --quiet', 'be quiet')
    .option('--project-id <projectId>', 'use this l10n-storage project instead of the one in the rc file (e.g. a cloned project for a migration rehearsal)')
    .on('--help', () => {
      console.info('\nRC file:\n  refer to [L10nConf] type or see \'l10nrc.schema.json\'')
    })

  program.command('plugins')
    .description('List installed plugins')
    .action(() => {
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

        const keyMode = await readRecordedKeyMode(domainName, domainConfig)
        await extractKeysWithRecord(domainName, domainConfig, keysPath, keyMode)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        await compileAll(domainName, domainConfig, transDir, { keyMode })
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

        const keyMode = await resolveKeyMode(config, domainConfig)
        await extractKeysWithRecord(domainName, domainConfig, keysPath, keyMode)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, { ...syncerOptions, keyMode }, true)
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

        const keyMode = await resolveKeyMode(config, domainConfig)
        await extractKeysWithRecord(domainName, domainConfig, keysPath, keyMode)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, true, { keyMode })
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

        const keyMode = await resolveKeyMode(config, domainConfig)
        await extractKeysWithRecord(domainName, domainConfig, keysPath, keyMode)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, { ...syncerOptions, keyMode })
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        if (opts.source) {
          await compileFromSource(cmd.name(), config, domainConfig, domainName, opts.source, keyMode)
        } else {
          await compileAll(domainName, domainConfig, transDir, { keyMode })
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
    report?: string,
  }
  type CheckReportDomain = {
    domain: string,
    tag: string,
    link?: string,
    untranslatedCount: number,
    untranslatedKeys: string[],
  }
  type CheckReportWarning = SyncerKeyWarning & {
    domain: string,
    tag: string,
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
    .option('--report <path>', 'write a machine-readable JSON report of untranslated keys and id key warnings (suppresses stdout dump); pair with --source for translation links and warnings')
    .argument('[files...]', 'files to check, if not specified, all files will be checked')
    .action(async (files: string[], opts: CheckOptions, cmd: Command) => {
      const syncerOptions = buildSyncerOptions(opts)
      const reportActive = opts.report != null
      const reportDomains: CheckReportDomain[] = []
      const reportWarnings: CheckReportWarning[] = []
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, skipUpload) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = opts['locales'] ? opts['locales'].split(',') : domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const specs = ['untranslated']
        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        const keyMode = opts['forceSync'] || opts.source != null
          ? await resolveKeyMode(config, domainConfig)
          : await readRecordedKeyMode(domainName, domainConfig)
        await extractKeysWithRecord(domainName, domainConfig, keysPath, keyMode)
        if (opts['forceSync']) {
          log.warn(cmd.name(), '--force-sync is deprecated. Run \'l10n download\' before \'l10n check\' instead.')
        }
        if (opts['forceSync'] || !await fileExists(transDir)) {
          await updateTrans(keysPath, transDir, transDir, locales, null)
          await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, { ...syncerOptions, keyMode })
        }
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        if (opts.source != null) {
          const keyWarnings = pluginRegistry.getKeyWarnings(config.getSyncTarget())
          const warnings = keyWarnings
            ? await keyWarnings(config, domainConfig, tag, opts.source, await readKeyEntries(keysPath))
            : []
          for (const warning of warnings) {
            log.warn(cmd.name(), warning.message)
            reportWarnings.push({ domain: domainName, tag, ...warning })
          }
        }

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
        // 미번역 키를 locale 간 dedupe 하여 도메인 단위로 모은다 (--report 사용 시).
        const untranslatedKeys = reportActive ? new Set<string>() : null
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

            if (untranslatedKeys != null) {
              untranslatedKeys.add(transEntry.key)
              continue
            }

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

        // 미번역이 0건인 도메인은 리포트에서 제외한다.
        if (untranslatedKeys != null && untranslatedKeys.size > 0) {
          const keyNames = [...untranslatedKeys]
          reportDomains.push({
            domain: domainName,
            tag,
            // source 가 있어야 tag/source 뷰 링크를 만들 수 있다. 없으면 link 생략.
            ...(opts.source != null
              ? { link: config.getL10nStorageConfig().getTranslationLink(tag, opts.source) }
              : {}),
            untranslatedCount: keyNames.length,
            untranslatedKeys: keyNames,
          })
        }
      })

      if (reportActive) {
        const report = {
          source: opts.source ?? null,
          domains: reportDomains,
          // 체크 결과에 영향을 주지 않는 공용 키 확인 경고. --source 를 지정했을 때만 계산한다.
          warnings: reportWarnings,
        }
        await fsp.writeFile(opts.report!, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf-8' })
        log.info(cmd.name(), `wrote untranslated report to ${opts.report}`)
      }
    })

  type MigrateKeysOptions = {
    apply?: boolean,
    minSyncerVersion?: string,
    rollback?: string,
    output?: string,
  }
  program.command('migrate-keys')
    .description('Copy translations of the source keys each resource uses to its id key and switch the tag to id key mode '
      + '(l10n-storage, resource formats only). Dry-run unless --apply is given')
    .option('--apply', 'apply the migration (or rollback); without it the server only computes the plan')
    .option('--min-syncer-version <version>', 'minimum syncer version to set on the tag after migration (required unless --rollback)')
    .option('--rollback <migrationId>', 'roll back an applied migration instead of migrating')
    .option('--output <path>', 'write the server responses as JSON')
    .action(async (opts: MigrateKeysOptions, cmd: Command) => {
      const dryRun = !opts.apply
      const outputs: unknown[] = []
      const writeOutput = async () => {
        if (opts.output != null) {
          await fsp.writeFile(opts.output, JSON.stringify(outputs, null, 2) + '\n', { encoding: 'utf-8' })
        }
      }
      // 적용한 뒤에 파일 쓰기가 실패해 나머지 도메인이 중단되지 않도록 요청 전에 쓸 수 있는지 확인한다.
      // 실패한 실행이 이전 실행의 이관 id 를 지우지 않도록 내용은 수정하지 않는다.
      if (opts.output != null) {
        await (await fsp.open(opts.output, 'a')).close()
      }

      if (opts.rollback != null) {
        if (opts.minSyncerVersion != null) {
          log.error(cmd.name(), '--min-syncer-version cannot be used with --rollback')
          process.exit(1)
        }
        const config = await loadCommandConfig(cmd.name())
        const keyMigration = getKeyMigrationOrExit(cmd.name(), config)
        const { response } = await keyMigration.rollback(config, opts.rollback, { dryRun })
        outputs.push({ migrationId: opts.rollback, response })
        await writeOutput()
        return
      }

      if (opts.minSyncerVersion == null) {
        log.error(cmd.name(), '--min-syncer-version is required')
        process.exit(1)
      }
      const minSyncerVersion = opts.minSyncerVersion
      // 한 도메인을 적용한 뒤 다른 도메인에서 실패하지 않도록, 모든 도메인을 추출해 검사한 뒤 요청한다
      type DomainKeys = {
        domainName: string,
        config: L10nConfig,
        domainConfig: DomainConfig,
        sourceKeyEntries: KeyEntry[],
        idKeyEntries: KeyEntry[],
      }
      const domainKeys: DomainKeys[] = []
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        getKeyMigrationOrExit(cmd.name(), config)
        // 리포 파일을 두 키 방식으로 각각 추출한다. 캐시의 keys 파일은 수정하지 않는다.
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'l10n-migrate-keys-'))
        try {
          const sourceKeysPath = getKeysPath(path.join(tempDir, 'source'))
          const idKeysPath = getKeysPath(path.join(tempDir, 'id'))
          await extractKeys(domainName, domainConfig, sourceKeysPath, { keyMode: 'source' })
          await extractKeys(domainName, domainConfig, idKeysPath, { keyMode: 'id' })
          const idKeyEntries = await readKeyEntries(idKeysPath)
          if (!idKeyEntries.some(entry => entry.idKey != null)) {
            log.error(cmd.name(), `domain ${domainName}: no resource uses an id key; the extractor of this domain does not support id keys`)
            // process.exit 는 finally 를 실행하지 않는다
            await fsp.rm(tempDir, { recursive: true, force: true })
            process.exit(1)
          }
          domainKeys.push({ domainName, config, domainConfig, sourceKeyEntries: await readKeyEntries(sourceKeysPath), idKeyEntries })
        } finally {
          await fsp.rm(tempDir, { recursive: true, force: true })
        }
      }, { uniqueTags: true })

      // 여러 도메인을 적용하면 이관 계획 오류도 모든 도메인을 dry-run 으로 확인한 뒤 적용한다
      if (!dryRun && domainKeys.length > 1) {
        const failedTags: string[] = []
        for (const { domainName, config, domainConfig, sourceKeyEntries, idKeyEntries } of domainKeys) {
          log.heading = `[${domainName}] ${cmd.name()}`
          const tag = domainConfig.getTag()
          const result = await getKeyMigrationOrExit(cmd.name(), config)
            .migrate(config, domainConfig, tag, sourceKeyEntries, idKeyEntries, { dryRun: true, minSyncerVersion })
          outputs.push({ domain: domainName, tag, response: result.response })
          if (result.errorCount > 0) {
            failedTags.push(tag)
          }
        }
        if (failedTags.length > 0) {
          await writeOutput()
          log.error(cmd.name(), `migration of tags ${failedTags.join(', ')} has errors; nothing was applied`)
          process.exit(1)
        }
        outputs.length = 0
      }

      for (const { domainName, config, domainConfig, sourceKeyEntries, idKeyEntries } of domainKeys) {
        log.heading = `[${domainName}] ${cmd.name()}`
        const tag = domainConfig.getTag()
        const keyMigration = getKeyMigrationOrExit(cmd.name(), config)
        const result = await keyMigration.migrate(config, domainConfig, tag, sourceKeyEntries, idKeyEntries, { dryRun, minSyncerVersion })
        // 되돌리기에 필요한 값이므로 -q 로 로그를 숨겨도, --output 파일 쓰기가 실패해도 출력한다
        if (result.migrationId != null) {
          process.stdout.write(`${result.migrationId}\n`)
        }
        outputs.push({ domain: domainName, tag, response: result.response })
        await writeOutput()
        if (result.errorCount > 0) {
          process.exitCode = 1
          if (!dryRun) {
            log.error(cmd.name(), `migration of tag ${tag} was rejected with ${result.errorCount} errors`)
            process.exit(1)
          }
        }
      }
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

        const keyMode = await readRecordedKeyMode(domainName, domainConfig)
        await extractKeysWithRecord(domainName, domainConfig, keysPath, keyMode)
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
          counts.push(`${locale}:${count}`)
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
            counts.push(`${locale}:${count}`)
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
          const keyMode = await resolveKeyMode(config, domainConfig)
          await compileFromSource(cmd.name(), config, domainConfig, domainName, opts.source, keyMode)
          return
        }
        const cacheDir = domainConfig.getCacheDir()
        const transDir = path.join(cacheDir, domainName)
        const keyMode = await readRecordedKeyMode(domainName, domainConfig)
        await compileAll(domainName, domainConfig, transDir, { keyMode })
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

        // 캐시의 keys 파일을 추출한 키 방식이다. 태그의 키 방식과 다르면 syncer 가 실패한다
        const keyMode = await readRecordedKeyMode(domainName, domainConfig)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, skipUpload, { ...syncerOptions, keyMode })
      })
    })

  program.parse(process.argv)
}

/** 로그 수준을 지정하고 rc 파일을 읽는다. 도메인을 순회하지 않는 명령도 같은 전역 옵션을 따른다 */
async function loadCommandConfig(cmdName: string): Promise<L10nConfig> {
  log.heading = cmdName

  const globalOpts = program.opts<ProgramOptions>()
  if (globalOpts['verbose']) {
    log.level = 'silly'
  } else if (globalOpts['quiet']) {
    log.level = 'warn'
  }

  return await loadConfig(globalOpts['rcfile'] || '.l10nrc', globalOpts['projectId'])
}

function getKeyMigrationOrExit(cmdName: string, config: L10nConfig): SyncerKeyMigration {
  const syncTarget = config.getSyncTarget()
  const keyMigration = pluginRegistry.getKeyMigration(syncTarget)
  if (!keyMigration) {
    log.error(cmdName, `key migration is not supported by sync target '${syncTarget}'`)
    process.exit(1)
  }
  return keyMigration
}

async function runSubCommand(
  cmdName: string,
  action: (domainName: string, config: L10nConfig, domainConfig: DomainConfig, skipUpload: boolean) => Promise<void>,
  options?: { uniqueTags?: boolean },
) {
  const globalOpts = program.opts<ProgramOptions>()
  const config = await loadCommandConfig(cmdName)
  // -d 에 같은 도메인을 두 번 적으면 같은 작업을 두 번 실행하게 된다
  const domainNames = [...new Set(globalOpts['domains'] || config.getDomainNames())]
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
    // -d 로 일부 도메인만 지정해도 rc 의 다른 도메인이 같은 태그를 쓰면 그 도메인의 리소스가 처리되지 않는다
    const sharingDomainNames = config.getDomainNames()
      .filter(name => name !== domainName && config.getDomainConfig(name)?.getTag() === domainConfig.getTag())
    if (options?.uniqueTags && sharingDomainNames.length > 0) {
      const sharing = sharingDomainNames.join(', ')
      log.error(cmdName, `domain ${domainName} shares tag ${domainConfig.getTag()} with ${sharing}, which ${cmdName} does not support`)
      process.exit(1)
    }
  }

  for (const domainName of domainNames) {
    const domainConfig = config.getDomainConfig(domainName)!
    log.heading = `[${domainName}] ${cmdName}`
    await action(domainName, config, domainConfig, skipUpload)
  }
}

async function loadConfig(rcPath: string, projectId: string | undefined): Promise<L10nConfig> {
  const explorer = cosmiconfig('l10n')
  const rc = await explorer.load(rcPath)
  const conf = parseL10nConf(rc?.config)
  if (projectId == null) {
    return new L10nConfig(conf)
  }
  const config = new L10nConfig(overrideL10nStorageProjectId(conf, projectId))
  if (config.getSyncTarget() !== 'l10n-storage') {
    throw new Error(`--project-id requires sync target l10n-storage, but it is ${config.getSyncTarget()}`)
  }
  log.warn('l10n', `using l10n-storage project ${projectId} instead of ${conf['l10n-storage']?.projectId} in ${rcPath}`)
  return config
}

try {
  await run()
} catch (err) {
  log.error('l10n', 'run failed', err)
  process.exit(1)
}
