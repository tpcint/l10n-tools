import type { Element } from 'domhandler'

export function getElementContent(src: string, elem: Element) {
  if (elem.children.length === 0) {
    return ''
  }
  const start = elem.children.at(0)!.startIndex!
  const end = elem.children.at(-1)!.endIndex!
  return src.substring(start, end + 1)
}

export function getElementContentIndex(elem: Element) {
  if (elem.children.length === 0) {
    return elem.endIndex! + 1
  }
  return elem.children.at(0)!.startIndex!
}
