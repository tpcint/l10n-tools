import log from 'npmlog'
import { KeyExtractor } from '../key-extractor.js'
import fsp from 'node:fs/promises'
import * as path from 'path'
import i18nStringsFiles from 'i18n-strings-files'
import plist, { type PlistObject } from 'plist'
import { glob } from 'tinyglobby'
import { execWithLog, fileExists, getTempDir } from '../utils.js'
import type { DomainConfig } from '../config.js'
import PQueue from 'p-queue'
import os from 'os'
import { writeKeyEntries } from '../entry.js'

const infoPlistKeys = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSUserTrackingUsageDescription',
]

export default async function (domainName: string, config: DomainConfig, keysPath: string) {
  const tempDir = path.join(getTempDir(), 'extractor')
  await fsp.mkdir(tempDir, { recursive: true })

  const extractor = new KeyExtractor({})
  const srcDir = config.getSrcDir()

  log.info('extractKeys', 'extracting from .swift files')
  const swiftQueue = new PQueue({ concurrency: os.cpus().length })
  async function extractFromSwift(swiftPath: string) {
    log.verbose('extractKeys', `processing '${swiftPath}'`)
    const baseName = path.basename(swiftPath, '.swift')
    const stringsDir = path.join(tempDir, 'swift', baseName)
    await fsp.mkdir(stringsDir, { recursive: true })

    await execWithLog(`genstrings -q -u -SwiftUI -o "${stringsDir}" "${swiftPath}"`)
    const stringsPath = path.join(stringsDir, 'Localizable.strings')
    if (await fileExists(stringsPath)) {
      const input = await fsp.readFile(stringsPath, { encoding: 'utf16le' })
      const swiftFile = swiftPath.substring(srcDir.length + 1)
      return { input, swiftFile }
    } else {
      return { input: null, swiftFile: null }
    }
  }
  const swiftPaths = await glob(`${srcDir}/**/*.swift`)
  const swiftExtracted = await swiftQueue.addAll(
    swiftPaths.map(swiftPath => () => extractFromSwift(swiftPath)),
  )
  for (const { input, swiftFile } of swiftExtracted) {
    if (input != null && swiftFile != null) {
      extractIosStrings(extractor, swiftFile, input)
    }
  }

  log.info('extractKeys', 'extracting from info.plist')
  const infoPlistPath = await getInfoPlistPath(srcDir)
  const infoPlist = plist.parse(await fsp.readFile(infoPlistPath, { encoding: 'utf-8' })) as PlistObject
  for (const key of infoPlistKeys) {
    if (infoPlist[key] != null) {
      extractor.addMessage({ filename: 'info.plist', line: key }, infoPlist[key] as string, { context: key })
    }
  }

  log.info('extractKeys', 'extracting from .xib, .storyboard files')
  const xibQueue = new PQueue({ concurrency: os.cpus().length })
  async function extractFromXib(xibPath: string): Promise<{ input: string, xibName: string }> {
    log.verbose('extractKeys', `processing '${xibPath}'`)
    const extName = path.extname(xibPath)
    const baseName = path.basename(xibPath, extName)
    const stringsPath = path.join(tempDir, `${baseName}.strings`)

    await execWithLog(`ibtool --export-strings-file "${stringsPath}" "${xibPath}"`)
    const input = await fsp.readFile(stringsPath, { encoding: 'utf16le' })
    const xibName = path.basename(xibPath)
    return { input, xibName }
  }
  const xibPaths = await getXibPaths(srcDir)
  const xibExtracted = await xibQueue.addAll(
    xibPaths.map(xibPath => () => extractFromXib(xibPath)),
  )

  for (const { input, xibName } of xibExtracted) {
    extractIosStrings(extractor, xibName, input)
  }

  await writeKeyEntries(keysPath, extractor.keys.toEntries())
  await fsp.rm(tempDir, { force: true, recursive: true })
}

async function getInfoPlistPath(srcDir: string) {
  const srcPattern = path.join(srcDir, '**', 'Info.plist')
  const paths = await glob(srcPattern)
  return paths[0]
}

async function getXibPaths(srcDir: string) {
  const xibPattern = path.join(srcDir, '**', 'Base.lproj', '*.xib')
  const storyboardPattern = path.join(srcDir, '**', 'Base.lproj', '*.storyboard')
  const baseXibPaths = []
  for (const srcPattern of [xibPattern, storyboardPattern]) {
    baseXibPaths.push(...await glob(srcPattern))
  }
  return baseXibPaths
}

function extractIosStrings(extractor: KeyExtractor, filename: string, src: string) {
  const data = i18nStringsFiles.parse(src, true)
  for (const [key, value] of Object.entries(data)) {
    const { defaultValue, ignore } = parseComment(key, value.comment)
    if (ignore) {
      continue
    }

    const id = value.text.trim()
    if (!id) {
      continue
    }
    if (defaultValue) {
      extractor.addMessage({ filename, line: key }, defaultValue, { context: key })
    } else {
      const comment = value.comment == 'No comment provided by engineer.' ? undefined : value.comment
      if (comment) {
        for (const line of comment.split('\n')) {
          extractor.addMessage({ filename }, key, { comment: line })
        }
      } else {
        extractor.addMessage({ filename }, key)
      }
    }
  }
}

function parseComment(key: string, commentText: string | undefined) {
  let defaultValue: string | null = null
  let ignore = false

  const [, field] = key.split('.')
  if (!commentText || !field) {
    return { defaultValue, ignore }
  }

  const commentData: { [key: string]: string } = {}
  const re = /\s*([^ ]+)\s*=\s*(".*?");/gmsui
  let match: RegExpExecArray | null = null
  while ((match = re.exec(commentText)) != null) {
    commentData[match[1]] = match[2]
  }

  if (commentData['Note']) {
    ignore = commentData['Note'].indexOf('#vv-ignore') >= 0
  }

  if (commentData['Class'] === '"UITextView"' && commentData['text'] && !ignore) {
    log.warn('extractKeys', `${key}: UITextView.text does not support Storyboard (xib) localization.`)
    log.warn('extractKeys', 'Consider localizing by code or note #vv-ignore to mute this warning')
  }

  if (commentData[key]) {
    defaultValue = JSON.parse(commentData[key])
  } else if (commentData[field]) {
    defaultValue = JSON.parse(commentData[field])
  }

  return { defaultValue, ignore }
}
