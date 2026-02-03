type CombinedCommentMap = { [tag: string]: Set<string> }

export function containsComment(description: string | undefined, tag: string, keyComments: string[]): boolean {
  if (isEmptyKeyComments(keyComments)) {
    return true
  }

  if (!description) {
    return false
  }

  const commentMap = parseDescription(description)
  if (commentMap[tag] == null) {
    return false
  }
  return keyComments
    .every(keyComment => !keyComment || commentMap[tag].has(keyComment))
}

export function addComment(description: string | undefined, tag: string, keyComments: string[]): string {
  const commentMap = parseDescription(description)
  for (const keyComment of keyComments) {
    if (!keyComment) {
      continue
    }
    if (keyComment.includes('\n')) {
      throw new Error(`comment cannot contains new line: ${keyComment}`)
    }
    if (!commentMap[tag]) {
      commentMap[tag] = new Set()
    }
    commentMap[tag].add(keyComment)
  }
  return stringifyDescription(commentMap)
}

export function getComments(description: string | undefined, tag: string): Set<string> {
  const commentMap = parseDescription(description)
  return commentMap[tag] ?? new Set()
}

export function removeComment(description: string | undefined, tag: string, keyComments: string[]): string {
  const commentMap = parseDescription(description)
  if (commentMap[tag]) {
    for (const keyComment of keyComments) {
      commentMap[tag].delete(keyComment)
    }
    if (commentMap[tag].size == 0) {
      delete commentMap[tag]
    }
  }
  return stringifyDescription(commentMap)
}

function isEmptyKeyComments(keyComments: string[]): boolean {
  if (keyComments.length == 0) {
    return true
  }
  return keyComments.every(line => !line)
}

function parseDescription(description: string | undefined): CombinedCommentMap {
  if (!description) {
    return {}
  }
  const commentMap: CombinedCommentMap = {}
  for (const line of description.split('\n')) {
    if (!line) {
      continue
    }
    const [tag, ...rest] = line.split(': ')
    if (commentMap[tag] == null) {
      commentMap[tag] = new Set()
    }
    commentMap[tag].add(rest.join(': '))
  }
  return commentMap
}

function stringifyDescription(commentMap: CombinedCommentMap): string {
  if (Object.keys(commentMap).length == 0) {
    return ''
  }
  const commentList: string[] = []
  for (const tag of Object.keys(commentMap).sort()) {
    for (const keyComment of [...commentMap[tag]].sort()) {
      if (keyComment) {
        commentList.push(`${tag}: ${keyComment}`)
      }
    }
  }
  return commentList.join('\n')
}
