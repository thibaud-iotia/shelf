// Background Steam installs: Steam has no public "install this app" command (steam://install
// always opens its dialog). It does download, at startup, every app whose appmanifest asks for
// it. Shelf writes that manifest — the same file Steam writes when an install is queued — and
// lets Steam start (or restart) in the tray. Pure helpers here; orchestration in steam.ts.

import { parseVdf, vdfObject, vdfString } from '../sources/vdf'

// appmanifest StateFlags (EAppState).
const FLAG_UPDATE_REQUIRED = 2
const FLAG_FULLY_INSTALLED = 4
const FLAG_UPDATE_RUNNING = 256
const FLAG_UPDATE_PAUSED = 512
const FLAG_UPDATE_STARTED = 1024

/** "Update required" + "update started": what Steam writes for an install queued in its dialog. */
export const QUEUED_STATE_FLAGS = FLAG_UPDATE_REQUIRED | FLAG_UPDATE_STARTED

export function manifestFileName(appId: number): string {
  return `appmanifest_${appId}.acf`
}

/**
 * Folder name under `steamapps/common`. Steam keeps the `installdir` of the manifest; the
 * store title is close to what Steam would pick. Characters Windows forbids are dropped.
 */
export function installDirName(title: string, appId: number): string {
  const name = title
    // Before NFKC, which would turn "™" into "TM".
    .replace(/[™®©]/g, '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return name || `app_${appId}`
}

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The manifest of an app queued for download, as Steam itself writes it. */
export function buildQueuedManifest(app: {
  appId: number
  name: string
  installDir: string
}): string {
  const fields: [string, string][] = [
    ['appid', String(app.appId)],
    ['Universe', '1'],
    ['name', app.name],
    ['StateFlags', String(QUEUED_STATE_FLAGS)],
    ['installdir', app.installDir],
    ['LastUpdated', '0'],
    ['SizeOnDisk', '0'],
    ['buildid', '0'],
    ['BytesToDownload', '0'],
    ['BytesDownloaded', '0'],
    ['AutoUpdateBehavior', '0'],
    ['AllowOtherDownloadsWhileRunning', '0']
  ]
  const body = fields.map(([key, value]) => `\t${quote(key)}\t\t${quote(value)}`).join('\n')
  return `"AppState"\n{\n${body}\n}\n`
}

export type SteamInstallState =
  | { kind: 'installed' }
  | { kind: 'queued' }
  | { kind: 'downloading'; downloaded: number; total: number }
  | { kind: 'paused'; downloaded: number; total: number }

const int = (value: string | undefined) => {
  const n = Number.parseInt(value ?? '0', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Where a first install stands, read from its manifest; null when the file is not a manifest. */
export function readInstallState(text: string): SteamInstallState | null {
  const state = vdfObject(parseVdf(text).appstate)
  if (!state || !vdfString(state.appid)) return null
  const flags = int(vdfString(state.stateflags))
  const busy = FLAG_UPDATE_REQUIRED | FLAG_UPDATE_RUNNING | FLAG_UPDATE_PAUSED | FLAG_UPDATE_STARTED
  // A first install only gets "fully installed" once its last file is written.
  if ((flags & FLAG_FULLY_INSTALLED) !== 0 && (flags & busy) === 0) return { kind: 'installed' }
  const total = int(vdfString(state.bytestodownload))
  const downloaded = Math.min(int(vdfString(state.bytesdownloaded)), total || Infinity)
  if ((flags & FLAG_UPDATE_PAUSED) !== 0) return { kind: 'paused', downloaded, total }
  if (total > 0 || (flags & FLAG_UPDATE_RUNNING) !== 0) {
    return { kind: 'downloading', downloaded, total }
  }
  return { kind: 'queued' }
}

const norm = (path: string) =>
  path
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()

/** Same folder for Steam (case and trailing separators ignored, as on Windows). */
export function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b)
}

/** `child` is `parent` or inside it. */
export function isInside(child: string, parent: string): boolean {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(`${p}/`)
}

/** `libraryfolder.vdf`: the marker Steam keeps at the top of each library folder. */
export function buildLibraryFolderFile(contentId: string): string {
  return `"libraryfolder"\n{\n\t"contentid"\t\t"${contentId}"\n\t"label"\t\t""\n}\n`
}

/** Content id of an existing `libraryfolder.vdf` (a library Steam forgot, an old disk). */
export function readLibraryContentId(text: string): string | null {
  const folder = vdfObject(parseVdf(text).libraryfolder)
  const id = vdfString(folder?.contentid)
  return id && /^\d+$/.test(id) ? id : null
}

function libraryEntry(index: number, path: string, contentId: string): string {
  return [
    `\t"${index}"`,
    '\t{',
    `\t\t"path"\t\t${quote(path)}`,
    '\t\t"label"\t\t""',
    `\t\t"contentid"\t\t"${contentId}"`,
    '\t\t"totalsize"\t\t"0"',
    '\t\t"update_clean_bytes_tobedeleted"\t\t"0"',
    '\t\t"time_last_update_verified"\t\t"0"',
    '\t\t"apps"',
    '\t\t{',
    '\t\t}',
    '\t}'
  ].join('\n')
}

/**
 * `libraryfolders.vdf` with one more library — what Steam › Storage › "Add drive" writes.
 * Null when the library is listed already. Only valid while Steam is closed: Steam rewrites
 * this file when it quits.
 */
export function addLibraryFolder(
  text: string | null,
  library: { root: string; path: string; contentId: string }
): string | null {
  if (!text?.trim()) {
    const root = libraryEntry(0, library.root, '0')
    if (samePath(library.root, library.path)) return `"libraryfolders"\n{\n${root}\n}\n`
    const entry = libraryEntry(1, library.path, library.contentId)
    return `"libraryfolders"\n{\n${root}\n${entry}\n}\n`
  }
  const folders = vdfObject(parseVdf(text).libraryfolders)
  if (!folders) throw new Error('libraryfolders.vdf illisible')
  let next = 0
  for (const [key, value] of Object.entries(folders)) {
    if (!/^\d+$/.test(key)) continue
    next = Math.max(next, Number(key) + 1)
    const path = vdfString(vdfObject(value)?.path)
    if (path && samePath(path, library.path)) return null
  }
  const end = text.lastIndexOf('}')
  if (end < 0) throw new Error('libraryfolders.vdf illisible')
  const before = text.slice(0, end).replace(/\s*$/, '\n')
  return `${before}${libraryEntry(next, library.path, library.contentId)}\n${text.slice(end)}`
}

/** Library with the most free space; the first one when sizes are unknown. */
export function pickLibrary(
  libraries: { path: string; freeBytes: number | null }[]
): string | null {
  let best: { path: string; freeBytes: number | null } | null = null
  for (const library of libraries) {
    if (!best || (library.freeBytes ?? -1) > (best.freeBytes ?? -1)) best = library
  }
  return best?.path ?? null
}
