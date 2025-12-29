#!/usr/bin/env node

import { Command } from 'commander'
import log from 'npmlog'
import { checkTransEntrySpecs, readKeyEntries, readTransEntries } from './entry.js'
import { fileExists, getKeysPath, getTransPath } from './utils.js'
import { updateTrans } from './common.js'
import { syncTransToTarget } from './syncer/index.js'
import * as path from 'path'
import { type DomainConfig, L10nConfig } from './config.js'
import { extractKeys } from './extractor/index.js'
import { compileAll } from './compiler/index.js'
import fsp from 'node:fs/promises'
import { cosmiconfig } from 'cosmiconfig'
import { fileURLToPath } from 'url'
import { Ajv } from 'ajv'
import { EntryCollection } from './entry-collection.js'

const program = new Command('l10n-tools')
const dirname = path.dirname(fileURLToPath(import.meta.url))

export type ProgramOptions = {
  rcfile?: string,
  domains?: string,
  skipValidation?: boolean,
  validationBaseLocale?: string,
  drySync?: boolean,
  verbose?: boolean,
  quiet?: boolean,
}

async function run() {
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

  program.command('upload')
    .description('Upload local changes to sync target (local files will not touched)')
    .action(async (opts, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, drySync) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, drySync)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)
      })
    })

  program.command('sync')
    .description('Synchronize local translations and sync target')
    .action(async (opts, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, drySync) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        await updateTrans(keysPath, transDir, transDir, locales, null)
        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, drySync)
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        await compileAll(domainName, domainConfig, transDir)
      })
    })

  type CheckOptions = {
    locales?: string,
    forceSync?: boolean,
  }
  program.command('check')
    .description('Check all translated')
    .option('-l, --locales [locales]', 'locales to check, all if not specified (comma separated)')
    .option('--force-sync', 'sync even if translations are cached')
    .argument('[files...]', 'files to check, if not specified, all files will be checked')
    .action(async (files: string[], opts: CheckOptions, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, drySync) => {
        const cacheDir = domainConfig.getCacheDir()
        const locales = opts['locales'] ? opts['locales'].split(',') : domainConfig.getLocales()
        const tag = domainConfig.getTag()
        const validationConfig = config.getValidationConfig(program.opts<ProgramOptions>())

        const specs = ['untranslated']
        const keysPath = getKeysPath(path.join(cacheDir, domainName))
        const transDir = path.join(cacheDir, domainName)

        await extractKeys(domainName, domainConfig, keysPath)
        if (opts['forceSync'] || !await fileExists(transDir)) {
          await updateTrans(keysPath, transDir, transDir, locales, null)
          await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, drySync)
        }
        await updateTrans(keysPath, transDir, transDir, locales, validationConfig)

        for (const locale of locales) {
          const transPath = getTransPath(transDir, locale)
          const useUnverified = config.useUnverified(locale)
          for (const transEntry of await readTransEntries(transPath)) {
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
    .option('-s, --spec [spec]', 'spec to count (required, negate if starting with !, comma separated) supported: total,translated,untranslated,<flag>')
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

  type CatOptions = {
    transDir?: string,
    locale?: string,
    spec?: string,
  }
  program.command('_cat')
    .description('Print translation entries (internal use only)')
    .option('--trans-dir [transDir]', 'directory to read translations')
    .option('-l, --locale [locale]', 'locale to print (required)')
    .option('-s, --spec [spec]', 'spec to print (required, negate if starting with !, comma separated) supported: total,translated,untranslated,<flag>')
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

  program.command('_compile')
    .description('Write domain asset from translations (internal use only)')
    .action(async (opts, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig) => {
        const cacheDir = domainConfig.getCacheDir()
        const transDir = path.join(cacheDir, domainName)
        await compileAll(domainName, domainConfig, transDir)
      })
    })

  program.command('_sync')
    .description('Synchronize translations to remote target (internal use only)')
    .action(async (opts, cmd: Command) => {
      await runSubCommand(cmd.name(), async (domainName, config, domainConfig, drySync) => {
        const tag = domainConfig.getTag()
        const cacheDir = domainConfig.getCacheDir()

        const transDir = path.join(cacheDir, domainName)
        const keysPath = getKeysPath(path.join(cacheDir, domainName))

        await syncTransToTarget(config, domainConfig, tag, keysPath, transDir, drySync)
      })
    })

  program.parse(process.argv)
}

async function runSubCommand(cmdName: string, action: (domainName: string, config: L10nConfig, domainConfig: DomainConfig, drySync: boolean) => Promise<void>) {
  log.heading = cmdName

  const globalOpts = program.opts<ProgramOptions>()
  if (globalOpts['verbose']) {
    log.level = 'silly'
  } else if (globalOpts['quiet']) {
    log.level = 'warn'
  }

  const config = await loadConfig(globalOpts['rcfile'] || '.l10nrc')
  const domainNames = globalOpts['domains'] || config.getDomainNames()
  const drySync = globalOpts['drySync'] || false

  for (const domainName of domainNames) {
    const domainConfig = config.getDomainConfig(domainName)
    if (domainConfig == null) {
      log.error(cmdName, `no config found for domain ${domainName}`)
      process.exit(1)
    }
    log.heading = `[${domainName}] ${cmdName}`
    await action(domainName, config, domainConfig, drySync)
  }
}

async function loadConfig(rcPath: string): Promise<L10nConfig> {
  const explorer = cosmiconfig('l10n')
  const rc = await explorer.load(rcPath)
  const ajv = new Ajv()
  const schema = JSON.parse(await fsp.readFile(path.join(dirname, '..', 'l10nrc.schema.json'), { encoding: 'utf-8' }))
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
