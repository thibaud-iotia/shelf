// Parser for Valve's text KeyValues format (libraryfolders.vdf, appmanifest_*.acf).
//   "AppState" { "appid" "1145360" "name" "Hades" }
// Keys are lower-cased so lookups don't depend on Valve's inconsistent casing.

export type VdfValue = string | VdfObject
export interface VdfObject {
  [key: string]: VdfValue
}

type Token = { type: 'string'; value: string } | { type: 'open' } | { type: 'close' }

function* tokenize(text: string): Generator<Token> {
  let i = 0
  while (i < text.length) {
    const char = text[i]!
    if (/\s/.test(char)) {
      i++
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (char === '{') {
      i++
      yield { type: 'open' }
    } else if (char === '}') {
      i++
      yield { type: 'close' }
    } else if (char === '"') {
      let value = ''
      i++
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1]!
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
        } else {
          value += text[i]
          i++
        }
      }
      i++ // closing quote
      yield { type: 'string', value }
    } else {
      // Unquoted token (rare, but valid KeyValues). Conditionals like [$WIN32] are skipped.
      let value = ''
      while (i < text.length && !/[\s{}"]/.test(text[i]!)) value += text[i++]
      if (!value.startsWith('[')) yield { type: 'string', value }
    }
  }
}

export function parseVdf(text: string): VdfObject {
  const root: VdfObject = {}
  const stack: VdfObject[] = [root]
  let pendingKey: string | null = null

  for (const token of tokenize(text)) {
    const current = stack.at(-1)!
    if (token.type === 'string') {
      if (pendingKey === null) {
        pendingKey = token.value.toLowerCase()
      } else {
        current[pendingKey] = token.value
        pendingKey = null
      }
    } else if (token.type === 'open') {
      if (pendingKey === null) throw new Error('VDF: "{" without key')
      const child: VdfObject = {}
      current[pendingKey] = child
      stack.push(child)
      pendingKey = null
    } else {
      if (stack.length === 1) throw new Error('VDF: unbalanced "}"')
      stack.pop()
    }
  }
  if (stack.length !== 1) throw new Error('VDF: unexpected end of file')
  return root
}

export function vdfObject(value: VdfValue | undefined): VdfObject | undefined {
  return value !== undefined && typeof value === 'object' ? value : undefined
}

export function vdfString(value: VdfValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
