import log from 'npmlog'
import type { TransMessages } from './entry.js'

export class ValidateError extends Error {}

export class UnexpectedFormatError extends ValidateError {}
export class FormatNotFoundError extends ValidateError {}
export class NoOrdinalFormatError extends ValidateError {}

type FormatDef = {
  type: string,
  regex: RegExp,
}

const formatDefs: FormatDef[] = [
  { type: 'c-format', regex: /%-?[0-9]*\.?[0-9]*(?:c|d|e|E|f|g|G|hi|hu|i|l|ld|li|lf|Lf|lu|lli|lld|llu|o|p|s|u|x|X|n|@)/g },
  { type: 'c-format-ordinal', regex: /%[1-9]+\$-?[0-9]*\.?[0-9]*(?:c|d|e|E|f|g|G|hi|hu|i|l|ld|li|lf|Lf|lu|lli|lld|llu|o|p|s|u|x|X|n|@)/g },
  { type: 'single-brace-named', regex: /\{[A-Za-z_][A-Za-z0-9_]*}/g },
]

export function validateMessages(baseMessages: TransMessages, messages: TransMessages) {
  validateMsg(baseMessages.other, messages.other)
  validateMsg(baseMessages.zero, messages.zero)
  validateMsg(baseMessages.one, messages.one)
  validateMsg(baseMessages.few, messages.few)
  validateMsg(baseMessages.many, messages.many)
}

export function validateMsg(baseMsg: string | undefined, msg: string | undefined) {
  if (!baseMsg || !msg) {
    return
  }
  if (!msg.trim()) {
    return
  }
  log.verbose('validate', `|${baseMsg.replace(/\n/g, '\\n')}| vs |${msg.replace(/\n/g, '\\n')}|`)
  for (const def of formatDefs) {
    validateFormat(baseMsg, msg, def)
  }
  validateMarkup(baseMsg, msg)
}

function validateFormat(baseMsg: string, msg: string, def: FormatDef) {
  const baseFormats = baseMsg.match(def.regex)
  const formats = msg.match(def.regex)
  if (def.type === 'c-format' && baseFormats != null && baseFormats.length > 1) {
    throw new NoOrdinalFormatError(`Use ordinal parameter (e.g. %$1s) in c-format for more then one formats in \`${baseMsg.replace(/\n/g, '\\n')}'`)
  }

  const baseFormatSet = new Set(baseFormats)
  const formatSet = new Set(formats)
  for (const format of baseFormatSet) {
    if (!formatSet.has(format)) {
      throw new FormatNotFoundError(`Expected placeholder \`${format}' is not present in \`${msg.replace(/\n/g, '\\n')}'`)
    }
    formatSet.delete(format)
  }
  for (const format of formatSet) {
    throw new UnexpectedFormatError(`Placeholder \`${format}' is unexpected in \`${msg.replace(/\n/g, '\\n')}'`)
  }
}

export class UnexpectedTagError extends ValidateError {}
export class TagNotFoundError extends ValidateError {}

const markupRegex = /<\/?[A-Za-z-]+(\s+[^>/]*)?\/?>/g

function validateMarkup(baseMsg: string, msg: string) {
  const baseTags = [...baseMsg.match(markupRegex) ?? []]
    .map(tag => normalizeTag(tag))
  const tags = [...msg.match(markupRegex) ?? []]
    .map(tag => normalizeTag(tag))

  const hasBrTag = baseTags.some(tag => isBrTag(tag))
  for (const tag of baseTags) {
    const index = tags.indexOf(tag)
    if (index < 0) {
      if (isBrTag(tag)) {
        // omitting br tag is permitted
        continue
      }
      throw new TagNotFoundError(`Expected tag \`${tag}' is not present in \`${msg.replace(/\n/g, '\\n')}'`)
    }
    tags.splice(index, 1)
  }
  for (const tag of tags) {
    if (hasBrTag && isBrTag(tag)) {
      // adding more br tag is permitted
      continue
    }
    throw new UnexpectedTagError(`Tag \`${tag}' is unexpected in \`${msg.replace(/\n/g, '\\n')}'`)
  }
}

function isBrTag(tag: string): boolean {
  return tag == '<br>' || tag == '<br/>'
}

function normalizeTag(tag: string): string {
  return tag
    .replace(/<\s+/g, '<')
    .replace(/\s+>/g, '>')
    .replace(/\s+=/g, '=')
    .replace(/=\s+/g, '=')
    .replace(/\s+\/>/g, '/>')
}
