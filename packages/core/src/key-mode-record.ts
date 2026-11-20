import fsp from 'node:fs/promises'
import path from 'node:path'
import log from 'npmlog'
import type { KeyMode } from './plugin-types.js'
import { isErrnoException } from './utils.js'

/**
 * 도메인 캐시 디렉토리의 keys 파일을 추출한 키 방식을 기록한 파일.
 * 동기화 대상에 접속하지 않는 명령이 이 값으로 추출·컴파일해야 캐시의 keys·trans 파일과 같은 키 방식을 쓴다.
 */
type KeyModeRecord = {
  tag: string,
  keyMode: KeyMode,
}

export function getKeyModeRecordPath(domainCacheDir: string): string {
  return path.join(domainCacheDir, 'key-mode.json')
}

export async function writeKeyModeRecord(domainCacheDir: string, tag: string, keyMode: KeyMode): Promise<void> {
  const record: KeyModeRecord = { tag, keyMode }
  await fsp.mkdir(domainCacheDir, { recursive: true })
  await fsp.writeFile(getKeyModeRecordPath(domainCacheDir), JSON.stringify(record, null, 2) + '\n', { encoding: 'utf-8' })
}

/**
 * 기록된 키 방식을 반환한다. 기록이 없거나, 형식이 잘못됐거나, 다른 태그의 기록이면 null 이다.
 * 형식이 잘못된 기록과 다른 태그의 기록은 경고를 출력한다. 파일 읽기 오류는 다른 캐시 파일처럼 전파한다.
 */
export async function readKeyModeRecord(domainCacheDir: string, tag: string): Promise<KeyMode | null> {
  const recordPath = getKeyModeRecordPath(domainCacheDir)
  let input: string
  try {
    input = await fsp.readFile(recordPath, { encoding: 'utf-8' })
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) {
      return null
    }
    throw err
  }

  let record: Partial<KeyModeRecord> | null = null
  try {
    record = JSON.parse(input) as Partial<KeyModeRecord> | null
  } catch {
    // 아래에서 형식이 잘못된 기록으로 처리한다
  }
  if (record == null || typeof record !== 'object' || (record.keyMode !== 'source' && record.keyMode !== 'id')) {
    log.warn('l10n', `ignoring invalid key mode record ${recordPath}`)
    return null
  }
  if (record.tag !== tag) {
    log.warn('l10n', `ignoring key mode record ${recordPath} of tag ${record.tag}, not ${tag}`)
    return null
  }
  return record.keyMode
}
