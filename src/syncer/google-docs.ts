import http from 'http'
import httpShutdown from 'http-shutdown'
import log from 'npmlog'
import * as path from 'path'
import type { KeyEntry, TransEntry } from '../entry.js'
import fsp from 'node:fs/promises'
import { type drive_v3, drive as googleDrive } from '@googleapis/drive'
import { sheets as googleSheets, type sheets_v4 } from '@googleapis/sheets'
import { OAuth2Client } from 'google-auth-library'
import open from 'open'
import type { DomainConfig, GoogleCredentials, GoogleDocsConfig, L10nConfig } from '../config.js'
import { EntryCollection } from '../entry-collection.js'

export async function syncTransToGoogleDocs(config: L10nConfig, domainConfig: DomainConfig, tag: string, keyEntries: KeyEntry[], allTransEntries: { [locale: string]: TransEntry[] }, drySync: boolean) {
  warnPlural(keyEntries)
  const googleDocsConfig = config.getGoogleDocsConfig()
  const sheetName = googleDocsConfig.getSheetName()
  const credentials = await googleDocsConfig.getCredentials()

  const drive = googleDrive('v3')
  const sheets = googleSheets('v4')

  const auth = await authorize(sheetName, credentials)

  const docId = await findDocumentId(drive, auth, googleDocsConfig)
  log.notice('syncTransToGoogleDocs', `docId: ${docId}`)

  const rows = await readSheet(sheets, sheetName, auth, docId)
  const columnMap = getColumnMap(rows[0])
  const sheetData = createSheetData(tag, rows, columnMap)
  updateSheetData(tag, keyEntries, allTransEntries, sheetData)
  updateTransEntries(tag, keyEntries, allTransEntries, sheetData)

  const docActions = await updateSheet(tag, rows, columnMap, sheetData)
  await applyDocumentActions(sheetName, sheets, auth, docId, docActions, drySync)
}

function warnPlural(keyEntries: KeyEntry[]) {
  for (const keyEntry of keyEntries) {
    if (keyEntry.isPlural) {
      log.warn('syncTransToGoogleDocs', `google-docs syncer does not support plurals (key: ${keyEntry.key})`)
      return
    }
  }
}

async function authorize(sheetName: string, credentials: GoogleCredentials) {
  const clientSecret = credentials.clientSecret
  const clientId = credentials.clientId
  const redirectUrl = 'http://localhost:8106/oauth2callback'
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl)

  const token = await getToken(oauth2Client)
  oauth2Client.setCredentials(token)
  return oauth2Client
}

async function getToken(oauth2Client: OAuth2Client) {
  const tokenDir = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
  if (tokenDir == null) {
    throw new Error('cannot find home')
  }
  const tokenPath = path.join(tokenDir, '.credentials', 'google-docs-syncer.json')

  // Check if we have previously stored a token.
  try {
    return JSON.parse(await fsp.readFile(tokenPath, { encoding: 'utf-8' }))
  } catch (err) {
    if (err instanceof SyntaxError) {
      log.warn('getToken', 'cannot parse token file', tokenPath, err)
    }
    const code = await readAuthCode(oauth2Client)
    log.info('getToken', `code is ${code}`)
    const r = await oauth2Client.getToken(code)
    await fsp.mkdir(path.dirname(tokenPath), { recursive: true })
    await fsp.writeFile(tokenPath, JSON.stringify(r.tokens))
    log.info('getToken', `token stored to ${tokenPath}`)
    return r.tokens
  }
}

async function readAuthCode(oauth2Client: OAuth2Client): Promise<string> {
  const server = httpShutdown(http.createServer())
  const code = await new Promise<string | null>(resolve => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    })

    server.on('request', (req, res) => {
      if (req.url!.indexOf('/oauth2callback') >= 0) {
        const url = new URL(req.url!)
        const params = new URLSearchParams(url.search)
        const code = params.get('code')
        res.end('Authentication successful! Please return to the console.')
        resolve(code)
      }
    })

    server.listen(8106, () => {
      open(authUrl, { wait: false })
    })
  })
  server.shutdown(err => {
    if (err) {
      log.warn('readAuthCode', 'failed to shutdown server', err)
    }
  })
  if (code == null) {
    throw new Error('no code received')
  }
  return code
}

const documentIdCache: { [docName: string]: string } = {}

async function findDocumentId(drive: drive_v3.Drive, auth: OAuth2Client, config: GoogleDocsConfig): Promise<string> {
  const docId = config.getDocId()
  if (docId != null) {
    return docId
  }
  const docName = config.getDocName()
  if (docName == null) {
    throw new Error('doc-id or doc-name is required')
  }
  log.info('syncTransToGoogleDocs', `finding doc by named ${docName}...`)
  if (documentIdCache[docName] == null) {
    const { files } = await drive.files.list({
      auth,
      q: `name = '${docName}' and trashed = false`,
      spaces: 'drive',
    }).then(r => r.data)
    if (files == null) {
      throw new Error(`no document named ${docName}, check this out`)
    }
    const docIds = files
      .filter(f => f.mimeType === 'application/vnd.google-apps.spreadsheet')
      .map(f => f.id)

    if (docIds.length === 0) {
      throw new Error(`no document named ${docName}, check this out`)
    }

    if (docIds.length > 1) {
      throw new Error(`one or more document named ${docName}, check this out`)
    }

    documentIdCache[docName] = docIds[0]!
  }
  return documentIdCache[docName]
}

async function readSheet(sheets: sheets_v4.Sheets, sheetName: string, auth: OAuth2Client, docId: string): Promise<string[][]> {
  log.info('readSheet', 'loading sheet')
  const { values: rows } = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId: docId,
    range: sheetName,
  }).then(r => r.data)
  if (rows == null) {
    throw new Error(`no rows in sheet ${sheetName}`)
  }
  log.notice('readSheet', `... ${rows.length} rows`)
  if (rows.length === 0) {
    throw new Error(`no header row in sheet ${sheetName}`)
  }
  return rows
}

type L10nColumnMap = {
  keys: number | null,
  source: number,
  tag: number,
  ref: number | null,
  targets: { [locale: string]: number },
  size: number,
}

function getColumnMap(headerRow: string[]): L10nColumnMap {
  const columns: { [key: string]: number | null } = {}
  const targets: { [locale: string]: number } = {}
  for (const [index, columnName] of headerRow.entries()) {
    if (columnName === 'keys') {
      columns.keys = index
    } else if (columnName === 'source') {
      columns.source = index
    } else if (columnName === 'tag') {
      columns.tag = index
    } else if (columnName === 'ref') {
      columns.ref = index
    } else if (columnName.startsWith('target-')) {
      targets[columnName.substring(7)] = index
    }
  }

  if (columns.source == null || columns.tag == null) {
    throw new Error('no \'source\' row in header of the sheet')
  }

  if (Object.keys(targets).length === 0) {
    throw new Error('no \'target-\' row in header of the sheet')
  }

  return {
    keys: columns.keys,
    source: columns.source,
    tag: columns.tag,
    ref: columns.ref,
    targets: targets,
    size: headerRow.length,
  }
}

function createSheetData(tag: string, rows: string[][], columnMap: L10nColumnMap): { [source: string]: L10nDataEntry } {
  const sheetData: { [source: string]: L10nDataEntry } = {}
  for (const [index, dataRow] of rows.slice(1).entries()) {
    const entry = readDataRow(dataRow, columnMap)
    if (!entry.source) {
      log.warn('createSheetData', `ignoring row ${toRowName(index + 1)}: no source`)
      continue
    }

    entry.keys = entry.keys.filter(key => !key.startsWith(`${tag}:`))

    entry.tags.delete('')
    entry.tags.delete('OK')
    entry.tags.delete('UNUSED')
    entry.tags.delete(tag)

    sheetData[entry.source] = entry
  }
  // console.log(JSON.stringify(sheetData, null, 2))
  return sheetData
}

type L10nDataEntry = {
  keys: string[],
  source: string,
  targets: { [locale: string]: string },
  tags: Set<string>,
  refs: string[],
}

function readDataRow(dataRow: string[], columnMap: L10nColumnMap): L10nDataEntry {
  const targets: { [locale: string]: string } = {}
  for (const [locale, localeColumn] of Object.entries(columnMap.targets)) {
    targets[locale] = decodeSheetText(dataRow[localeColumn])
  }

  let keys: string[]
  if (columnMap.keys != null) {
    keys = decodeSheetText(dataRow[columnMap.keys]).split('\n').filter(key => !!key)
  } else {
    keys = []
  }

  return {
    keys: keys,
    source: decodeSheetText(dataRow[columnMap.source]),
    targets: targets,
    tags: new Set(decodeSheetText(dataRow[columnMap.tag]).split(',')),
    refs: decodeSheetText(columnMap.ref ? dataRow[columnMap.ref] : '').split('\n').filter(ref => ref),
  }
}

function updateSheetData(tag: string, keyEntries: KeyEntry[], allTransEntries: { [locale: string]: TransEntry[] }, sheetData: { [source: string]: L10nDataEntry }) {
  for (const keyEntry of keyEntries) {
    const entryKey = keyEntry.key
    if (!sheetData[entryKey]) {
      sheetData[entryKey] = {
        keys: [],
        source: keyEntry.key,
        targets: {},
        tags: new Set(),
        refs: [],
      }
    }

    const sheetEntry = sheetData[entryKey]
    if (keyEntry.context) {
      sheetEntry.keys.push(`${tag}:${keyEntry.context}`)
    }

    const thisRefs = keyEntry.references.filter(ref => ref)
      .map(ref => `${tag}:${ref}`)
    const otherRefs = sheetEntry.refs.filter(ref => !ref.startsWith(`${tag}:`))
    sheetEntry.refs = [...otherRefs, ...thisRefs]
  }

  for (const [locale, transEntries] of Object.entries(allTransEntries)) {
    // console.log('update sheet locale', locale)
    for (const transEntry of transEntries) {
      const entryKey = transEntry.key
      // console.log('update sheet entry key', entryKey)
      // console.log('matched entry (locale)', locale)
      // console.log('po entry', poEntry)

      if (!sheetData[entryKey]) {
        sheetData[entryKey] = {
          keys: [],
          source: transEntry.key,
          targets: {},
          tags: new Set(),
          refs: [],
        }
      }

      const sheetEntry = sheetData[entryKey]

      sheetEntry.tags.add(tag)

      if (transEntry.messages.other) {
        if (!sheetEntry.targets[locale] || sheetEntry.targets[locale].startsWith('$$needs review$$')) {
          sheetEntry.targets[locale] = '$$needs review$$ ' + transEntry.messages.other
        }
      }
    }
  }
  // console.log('updated sheet data', sheetData)
}

function updateTransEntries(tag: string, keyEntries: KeyEntry[], allTransEntries: { [locale: string]: TransEntry[] }, sheetData: { [source: string]: L10nDataEntry }) {
  for (const sheetEntry of Object.values(sheetData)) {
    for (const [locale, target] of Object.entries(sheetEntry.targets)) {
      if (allTransEntries[locale] != null) {
        const trans = EntryCollection.loadEntries(allTransEntries[locale])
        const transEntries: TransEntry[] = []
        for (const tagKey of sheetEntry.keys.filter(key => key.startsWith(`${tag}:`))) {
          const key = tagKey.substr(tag.length + 1)
          const transEntry = trans.find(key, sheetEntry.source)
          if (transEntry) {
            transEntries.push(transEntry)
          }
        }
        const transEntry = trans.find(null, sheetEntry.source)
        if (transEntry) {
          transEntries.push(transEntry)
        }

        for (const transEntry of transEntries) {
          // console.log('updating po, sheet entry', sheetEntry)
          // console.log('updating po, po', po)
          const entryKey = transEntry.key
          // console.log('updating po, po entry', poEntry)
          sheetEntry.tags.add(tag)
          if (target === '$$no translation$$') {
            if (transEntry.flag !== 'no-translation') {
              log.verbose('updateTransEntries', `mark 'no-translation' flag of ${locale} of ${entryKey}`)
              transEntry.flag = 'no-translation'
            }
          } else if (target === '$$needs translation$$') {
            if (transEntry.flag !== 'needs-translation') {
              log.verbose('updateTransEntries', `mark 'needs-translation' flag of ${locale} of ${entryKey}`)
              transEntry.flag = 'needs-translation'
            }
          } else if (target.startsWith('$$needs review$$')) {
            // do not update po msgstr
          } else {
            if (transEntry.flag) {
              log.verbose('updateTransEntries', `remove mark of ${locale} of ${entryKey}`)
              transEntry.flag = null
            }

            if (target && target !== transEntry.messages.other) {
              log.verbose('updateTransEntries', `updating value of ${entryKey}: ${transEntry.messages.other} -> ${target}`)
              transEntry.messages.other = target
            }
          }
        }
      }
    }
  }
  // console.log('updated po data', JSON.stringify(poData, null, 2))
}

type L10nDocUpdateCellAction = {
  type: 'update-cell',
  row: number,
  column: number,
  data: string,
}

type L10nDocAppendRowAction = {
  type: 'append-row',
  data: string[],
}

type L10nDocAction = L10nDocUpdateCellAction | L10nDocAppendRowAction

async function updateSheet(tag: string, rows: string[][], columnMap: L10nColumnMap, sheetData: { [source: string]: L10nDataEntry }) {
  const docActions: L10nDocAction[] = []
  for (const [index, dataRow] of rows.slice(1).entries()) {
    const rowEntry = readDataRow(dataRow, columnMap)
    const entryId = rowEntry.source
    if (!entryId) {
      continue
    }

    const sheetEntry = sheetData[entryId]
    if (sheetEntry != null) {
      if (columnMap.keys) {
        const otherKeys = rowEntry.keys.filter(key => !key.startsWith(`${tag}:`))
        const thisKeys = sheetEntry.keys.filter(key => key.startsWith(`${tag}:`))
        const newKeys = [...otherKeys, ...thisKeys].sort().join('\n')
        const oldKeys = [...rowEntry.keys].sort().join('\n')
        if (oldKeys !== newKeys) {
          log.notice('updateSheet', `setting keys of ${entryId}: ${newKeys}`)
          docActions.push({
            type: 'update-cell',
            row: index + 1,
            column: columnMap.keys,
            data: encodeSheetText(newKeys),
          })
        }
      }

      const oldTag = Array.from(rowEntry.tags).sort().join(',')
      const newTag = Array.from(sheetEntry.tags).sort().join(',') || 'UNUSED'
      if (oldTag !== newTag) {
        log.notice('updateSheet', `setting tag of ${entryId}: ${newTag}`)
        docActions.push({
          type: 'update-cell',
          row: index + 1,
          column: columnMap.tag,
          data: encodeSheetText(newTag),
        })
      }

      for (const [locale, value] of Object.entries(rowEntry.targets)) {
        const newValue = sheetEntry.targets[locale]
        if (value !== newValue) {
          log.notice('updateSheet', `updating value of ${locale}: ${value} -> ${newValue}`)
          docActions.push({
            type: 'update-cell',
            row: index + 1,
            column: columnMap.targets[locale],
            data: encodeSheetText(newValue),
          })
        }
      }

      if (columnMap.ref) {
        const otherRefs = rowEntry.refs.filter(ref => !ref.startsWith(`${tag}:`))
        const thisRefs = sheetEntry.refs.filter(ref => ref.startsWith(`${tag}:`))
        const newRef = [...otherRefs, ...thisRefs].sort().join('\n')
        const oldRef = rowEntry.refs.join('\n')
        if (oldRef !== newRef) {
          log.notice('updateSheet', `setting ref of ${entryId}: ${newRef}`)
          docActions.push({
            type: 'update-cell',
            row: index + 1,
            column: columnMap.ref,
            data: encodeSheetText(newRef),
          })
        }
      }

      delete sheetData[entryId]
    }
  }

  for (const [entryId, sheetEntry] of Object.entries(sheetData)) {
    if (sheetEntry.keys.length > 0 && !columnMap.keys) {
      log.warn('updateSheet', `ignoring ${sheetEntry.keys}: no keys column`)
      continue
    }

    const row = new Array<string>(columnMap.size).fill('')
    if (columnMap.keys) {
      row[columnMap.keys] = encodeSheetText([...new Set(sheetEntry.keys)].sort().join('\n'))
    }
    row[columnMap.source] = encodeSheetText(sheetEntry.source)
    row[columnMap.tag] = encodeSheetText([...sheetEntry.tags].sort().join(',') || 'UNUSED')

    for (const [locale, value] of Object.entries(sheetEntry.targets)) {
      if (columnMap.targets[locale] == null) {
        log.warn('updateSheet', `ignoring ${locale}: no column`)
        continue
      }
      row[columnMap.targets[locale]] = encodeSheetText(value)
    }

    if (columnMap.ref) {
      row[columnMap.ref] = encodeSheetText(sheetEntry.refs.sort().join('\n'))
    }

    log.warn('updateSheet', `appending row of ${entryId}`)
    docActions.push({
      type: 'append-row',
      data: row,
    })
  }

  // console.log('doc actions', JSON.stringify(docActions, null, 2))
  return docActions
}

async function applyDocumentActions(sheetName: string, sheets: sheets_v4.Sheets, auth: OAuth2Client, docId: string, docActions: L10nDocAction[], drySync: boolean) {
  const updateData: { range: string, values: string[][] }[] = []
  const newRows: string[][] = []

  for (const action of docActions) {
    if (action.type === 'append-row') {
      newRows.push(action.data)
    } else if (action.type === 'update-cell') {
      updateData.push({
        range: `'${sheetName}'!${toCellName(action.row, action.column)}`,
        values: [[action.data]],
      })
    }
  }

  if (updateData.length > 0) {
    if (drySync) {
      log.notice('drySync', 'updating rows', JSON.stringify(updateData, null, 2))
    } else {
      await sheets.spreadsheets.values.batchUpdate({
        auth,
        spreadsheetId: docId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateData,
        },
      }).then(r => r.data)
    }
  }

  if (newRows.length > 0) {
    if (drySync) {
      log.notice('drySync', 'creating rows', JSON.stringify(newRows, null, 2))
    } else {
      await sheets.spreadsheets.values.append({
        auth,
        spreadsheetId: docId,
        range: sheetName,
        valueInputOption: 'RAW',
        requestBody: {
          values: newRows,
        },
      }).then(r => r.data)
    }
  }
}

function toColumnName(column: number): string {
  column += 1
  let name = ''
  while (column > 0) {
    // console.log('reminder', column, String.fromCharCode('A'.charCodeAt(0) + ((column - 1) % 26)))
    // console.log('next column', Math.floor((column - 1) / 26))
    name = String.fromCharCode('A'.charCodeAt(0) + ((column - 1) % 26)) + name
    column = Math.floor((column - 1) / 26)
  }
  return name
}

function toRowName(row: number): string {
  return (row + 1).toString()
}

function toCellName(row: number, column: number): string {
  return toColumnName(column) + toRowName(row)
}

function encodeSheetText(text: string | null): string {
  if (text == null)
    return ''
  return text
}

function decodeSheetText(sheetText: string | null): string {
  if (sheetText == null)
    return ''
  return sheetText.replace(/\r\n/g, '\n')
}
