import { readText } from './fs'
import { parseVdf, vdfObject, vdfString, type VdfObject } from './vdf'

// Steam publishes what it is doing:
//   Windows: HKCU\Software\Valve\Steam  RunningAppID (REG_DWORD),
//            HKCU\Software\Valve\Steam\ActiveProcess  pid,
//            HKCU\Software\Valve\Steam\Apps\<appid>  Updating;
//   Linux / macOS: registry.vdf, same tree under Registry > HKCU > Software > Valve > Steam.

/** What Shelf knows of the Steam client while it follows games launched through it. */
export interface SteamStatus {
  /** Game Steam is running: 0 when none, null when unreadable. */
  runningAppId: number | null
  /** Steam client process alive; null when unknown. */
  clientRunning: boolean | null
  /** Among the app ids asked, those Steam is updating. */
  updatingAppIds: number[]
}

/** Raw values as read from the registry or registry.vdf. */
export interface SteamRawStatus {
  runningAppId?: string
  pid?: string
  /** Updating flag per app id. */
  updating: Record<number, string | undefined>
}

/** `0x...` (reg query) or decimal. Null when unreadable. */
export function parseAppId(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = raw.trim().toLowerCase().startsWith('0x')
    ? Number.parseInt(raw.trim(), 16)
    : Number.parseInt(raw.trim(), 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** Signal 0 only checks the process exists (EPERM: it exists, owned by someone else). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function toSteamStatus(
  raw: SteamRawStatus,
  isAlive: (pid: number) => boolean = isProcessAlive
): SteamStatus {
  const pid = parseAppId(raw.pid)
  return {
    runningAppId: parseAppId(raw.runningAppId),
    // Steam resets the pid to 0 when it quits; a stale pid (crash) is checked against the OS.
    clientRunning: pid === null ? null : pid > 0 && isAlive(pid),
    updatingAppIds: Object.entries(raw.updating)
      .filter(([, flag]) => (parseAppId(flag) ?? 0) > 0)
      .map(([appId]) => Number(appId))
  }
}

function steamKeyOfVdf(text: string): VdfObject | undefined {
  let path = vdfObject(parseVdf(text).registry)
  for (const key of ['hkcu', 'software', 'valve', 'steam']) path = vdfObject(path?.[key])
  return path
}

export function steamRawStatusFromVdf(text: string, appIds: number[]): SteamRawStatus {
  const steam = steamKeyOfVdf(text)
  const apps = vdfObject(steam?.apps)
  return {
    runningAppId: vdfString(steam?.runningappid),
    pid: vdfString(vdfObject(steam?.activeprocess)?.pid),
    updating: Object.fromEntries(
      appIds.map((id) => [id, vdfString(vdfObject(apps?.[String(id)])?.updating)])
    )
  }
}

export function runningAppIdFromVdf(text: string): number | null {
  return parseAppId(vdfString(steamKeyOfVdf(text)?.runningappid))
}

/** Status from the first readable registry.vdf among `files`; unknown when none is. */
export async function readSteamStatusFromVdf(
  files: string[],
  appIds: number[]
): Promise<SteamStatus> {
  for (const file of files) {
    const text = await readText(file)
    if (text === null) continue
    try {
      return toSteamStatus(steamRawStatusFromVdf(text, appIds))
    } catch {
      continue
    }
  }
  return { runningAppId: null, clientRunning: null, updatingAppIds: [] }
}
