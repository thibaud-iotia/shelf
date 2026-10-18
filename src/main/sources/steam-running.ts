import { readText } from './fs'
import { parseVdf, vdfObject, vdfString } from './vdf'

// Steam publishes the id of the game it is running (0 when none):
//   Windows: HKCU\Software\Valve\Steam  RunningAppID (REG_DWORD)
//   Linux / macOS: registry.vdf  Registry > HKCU > Software > Valve > Steam > RunningAppID

/** `0x...` (reg query) or decimal. Null when unreadable. */
export function parseAppId(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = raw.trim().toLowerCase().startsWith('0x')
    ? Number.parseInt(raw.trim(), 16)
    : Number.parseInt(raw.trim(), 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function runningAppIdFromVdf(text: string): number | null {
  let path = vdfObject(parseVdf(text).registry)
  for (const key of ['hkcu', 'software', 'valve', 'steam']) path = vdfObject(path?.[key])
  return parseAppId(vdfString(path?.runningappid))
}

/** First readable registry.vdf among `files`. */
export async function readRunningAppIdFromVdf(files: string[]): Promise<number | null> {
  for (const file of files) {
    const text = await readText(file)
    if (text === null) continue
    try {
      return runningAppIdFromVdf(text)
    } catch {
      continue
    }
  }
  return null
}
