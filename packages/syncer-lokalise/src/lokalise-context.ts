import log from 'npmlog'

type CombinedContextMap = { [tag: string]: string[] }

export function containsContext(context: string | undefined, tag: string, keyContext: string | null): boolean {
  if (!keyContext) {
    return true
  }

  if (!context) {
    return false
  }

  const contextMap = parseContext(context)
  return contextMap[tag]?.includes(keyContext)
}

export function addContext(context: string | undefined, tag: string, keyContext: string | null): string {
  const contextMap = parseContext(context)
  if (keyContext) {
    if (!contextMap[tag]) {
      contextMap[tag] = []
    }
    if (!contextMap[tag].includes(keyContext)) {
      contextMap[tag].push(keyContext)
    }
  }
  if (Object.keys(contextMap).length == 0) {
    return ''
  } else {
    return JSON.stringify(contextMap)
  }
}

export function getContexts(context: string | undefined, tag: string, fillNull: boolean): (string | null)[] {
  const contextMap = parseContext(context)
  if (!contextMap[tag]) {
    if (fillNull) {
      return [null]
    } else {
      return []
    }
  }
  return contextMap[tag]
}

export function removeContext(context: string | undefined, tag: string, keyContext: string | null): string {
  const contextMap = parseContext(context)
  if (keyContext) {
    if (contextMap[tag]) {
      const index = contextMap[tag].findIndex(ctxt => ctxt == keyContext)
      if (index >= 0) {
        contextMap[tag].splice(index, 1)
        if (contextMap[tag].length == 0) {
          delete contextMap[tag]
        }
      }
    }
  }
  if (Object.keys(contextMap).length == 0) {
    return ''
  } else {
    return JSON.stringify(contextMap)
  }
}

function isCombinedContextMap(value: unknown): value is CombinedContextMap {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return false
  }
  return Object.values(value as Record<string, unknown>)
    .every(keyContexts => Array.isArray(keyContexts) && keyContexts.every(keyContext => typeof keyContext === 'string'))
}

function parseContext(context: string | undefined): CombinedContextMap {
  if (!context) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(context)
  } catch (err) {
    log.warn('parseContext', 'context not recognized', context, err)
    return {}
  }
  // 파싱은 됐지만 형태가 다른 경우(예: `{"tag": 1}`)를 걸러낸다. 그대로 두면
  // addContext/removeContext/getContexts에서 배열 메서드 호출로 터진다.
  if (!isCombinedContextMap(parsed)) {
    log.warn('parseContext', 'context shape not recognized', context)
    return {}
  }
  return parsed
}
