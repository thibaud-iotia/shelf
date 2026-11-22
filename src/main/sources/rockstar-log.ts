// Rockstar Games Launcher log (`Documents\Rockstar Games\Launcher\launcher.log`, the previous
// runs in `launcher.01.log` … `launcher.09.log`, oldest last). The launcher exposes nothing
// else in clear: its log tells which games are installed and up to date, which game it starts
// and when it exits. Lines look like:
//   [2024-11-03 21:26:40.036] [DISPLAY] [24300] [gamelaunch] Launching game...
//   [2024-11-03 21:26:40.036] [DISPLAY] [24300] [gamelaunch]  Path: C:\…\GTA5_BE.exe
//   [2024-11-03 22:00:39.636] [DISPLAY] [24300] [gamelaunch] Game exited with code 0x0 (0)
// Times are local. A game launch and its exit are logged by the same thread.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface RockstarLogEntry {
  /** Epoch ms (the log writes local time). */
  time: number
  thread: string
  category: string
  /** Text after the category, leading spaces kept (table rows are aligned). */
  message: string
}

const LINE =
  /^\[(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?\] \[[A-Z]+\] \[([^\]]*)\] \[([^\]]+)\] ?(.*)$/

export function parseRockstarLog(text: string): RockstarLogEntry[] {
  const entries: RockstarLogEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw)
    if (!m) continue
    const [, y, mo, d, h, mi, s, ms, thread, category, message] = m
    entries.push({
      time: new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!, +(ms ?? 0)).getTime(),
      thread: thread!.trim(),
      category: category!.trim(),
      message: message!.trimEnd()
    })
  }
  return entries
}

/** The log files, newest first. */
export function rockstarLogFiles(dir: string): string[] {
  return [
    join(dir, 'launcher.log'),
    ...Array.from({ length: 9 }, (_, i) => join(dir, `launcher.0${i + 1}.log`))
  ]
}

/**
 * Entries of every log file still on disk, oldest first. The launcher writes in the ANSI
 * code page: latin1 keeps the accented paths readable.
 */
export async function readRockstarLogs(dir: string, files = 10): Promise<RockstarLogEntry[]> {
  const texts = await Promise.all(
    rockstarLogFiles(dir)
      .slice(0, files)
      .map((file) =>
        readFile(file).then(
          (data) => data.toString('latin1'),
          () => null
        )
      )
  )
  return texts.reverse().flatMap((text) => (text ? parseRockstarLog(text) : []))
}

/** A game run seen in the log. `endedAt` null: no exit logged (still running, or cut short). */
export interface RockstarSession {
  /** Executable the launcher started (the BattlEye wrapper for some games). */
  path: string
  startedAt: number
  endedAt: number | null
}

export function readSessions(entries: RockstarLogEntry[]): RockstarSession[] {
  const sessions: RockstarSession[] = []
  // Thread → session being launched or running.
  const open = new Map<string, RockstarSession | 'launching'>()
  for (const entry of entries) {
    if (entry.category === 'launcher' && entry.message === 'Opening log file.') {
      // A new run of the launcher: what was left open in the previous one never exited cleanly.
      open.clear()
      continue
    }
    if (entry.category !== 'gamelaunch') continue
    const message = entry.message.trim()
    if (message === 'Launching game...') {
      open.set(entry.thread, 'launching')
    } else if (message.startsWith('Path:') && open.get(entry.thread) === 'launching') {
      const session = { path: message.slice(5).trim(), startedAt: entry.time, endedAt: null }
      sessions.push(session)
      open.set(entry.thread, session)
    } else if (message.startsWith('Game exited')) {
      const session = open.get(entry.thread)
      if (session && session !== 'launching') session.endedAt = entry.time
      open.delete(entry.thread)
    }
  }
  return sessions
}

/** A row of the "Installed titles" table the launcher writes when it starts. */
export interface RockstarTitleRow {
  name: string
  /** "Up-to-date", or "131.84 Mo / 5.37 Go" while an update is queued or downloading. */
  progress: string
  version: string
  location: string
  /** An update is queued, downloading or paused. */
  pending: boolean
  downloadedBytes: number | null
  totalBytes: number | null
}

const UNITS: Record<string, number> = {
  b: 1,
  o: 1,
  kb: 1024,
  ko: 1024,
  mb: 1024 ** 2,
  mo: 1024 ** 2,
  gb: 1024 ** 3,
  go: 1024 ** 3,
  tb: 1024 ** 4,
  to: 1024 ** 4
}

/** "5.37 Go", "131,84 MB" → bytes; null when not a size. */
export function parseSize(text: string): number | null {
  const m = /^([\d.,]+)\s*([a-z]{1,2})$/i.exec(text.trim())
  const unit = m ? UNITS[m[2]!.toLowerCase()] : undefined
  if (!m || !unit) return null
  const value = Number(m[1]!.replace(',', '.'))
  return Number.isFinite(value) ? Math.round(value * unit) : null
}

function tableRow(header: string, message: string): RockstarTitleRow | null {
  const at = (name: string) => header.indexOf(name)
  const [progressAt, versionAt, locationAt] = [at('Progress'), at('Version'), at('Location')]
  if (progressAt < 0 || versionAt < progressAt || locationAt < versionAt) return null
  const name = message.slice(0, progressAt).trim()
  const progress = message.slice(progressAt, versionAt).trim()
  if (!name) return null
  const sizes = progress.split('/').map((part) => parseSize(part))
  const pending = sizes.length === 2 && sizes[1] !== null
  return {
    name,
    progress,
    version: message.slice(versionAt, locationAt).trim(),
    location: message.slice(locationAt).trim(),
    pending,
    downloadedBytes: pending ? sizes[0]! : null,
    totalBytes: pending ? sizes[1]! : null
  }
}

/** The last "Installed titles" table of the log, with its time; null when none. */
export function readTitleTable(
  entries: RockstarLogEntry[]
): { time: number; rows: RockstarTitleRow[] } | null {
  let last: { time: number; rows: RockstarTitleRow[] } | null = null
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.message.trim() !== 'Installed titles:') continue
    const header = entries[i + 1]
    if (!header || header.category !== entry.category || !/^\s*Title\s/.test(header.message)) {
      continue
    }
    const rows: RockstarTitleRow[] = []
    let j = i + 2
    for (; j < entries.length; j++) {
      const next = entries[j]!
      if (next.category !== entry.category || next.time - entry.time > 1_000) break
      if (!next.message.startsWith(' ')) break
      const row = tableRow(header.message, next.message)
      if (row) rows.push(row)
    }
    last = { time: entry.time, rows }
    i = j - 1
  }
  return last
}

export type RockstarUpdateOutcome = 'succeeded' | 'paused' | 'failed'

/** "[titleupdater] Update of <name> succeeded." lines after `since`, last outcome per name. */
export function readUpdateOutcomes(
  entries: RockstarLogEntry[],
  since = 0
): Map<string, { outcome: RockstarUpdateOutcome; time: number }> {
  const outcomes = new Map<string, { outcome: RockstarUpdateOutcome; time: number }>()
  for (const entry of entries) {
    if (entry.time < since || entry.category !== 'titleupdater') continue
    const m = /^(?:Update|Install(?:ation)?) of (.+?) (succeeded|was paused|failed)\b/.exec(
      entry.message.trim()
    )
    if (!m) continue
    const outcome = m[2] === 'was paused' ? 'paused' : (m[2] as RockstarUpdateOutcome)
    outcomes.set(normalizeName(m[1]!), { outcome, time: entry.time })
  }
  return outcomes
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function sameFolder(a: string, b: string): boolean {
  const clean = (p: string) =>
    p
      .replace(/[\\/]+$/, '')
      .replace(/\//g, '\\')
      .toLowerCase()
  return clean(a) === clean(b)
}

/** `path` is `folder` or inside it (Windows paths, any separator, any case). */
export function isInsideFolder(path: string, folder: string): boolean {
  const clean = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  const f = clean(folder)
  const p = clean(path)
  return p === f || p.startsWith(`${f}\\`)
}

/**
 * Install folders with an update pending: listed with a size in the last table, and not
 * finished since (the table is only written when the launcher starts).
 */
export function pendingUpdateFolders(entries: RockstarLogEntry[]): string[] {
  const table = readTitleTable(entries)
  if (!table) return []
  const outcomes = readUpdateOutcomes(entries, table.time)
  return table.rows
    .filter((row) => row.pending && outcomes.get(normalizeName(row.name))?.outcome !== 'succeeded')
    .map((row) => row.location)
    .filter(Boolean)
}

/** Title ids the launcher was asked to start after `since` ("Launch requested by user: gta5"). */
export function launchRequests(entries: RockstarLogEntry[], since: number): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (entry.time < since) continue
    const m =
      /^Launch requested by user: ([a-z0-9_]+)/i.exec(entry.message.trim()) ??
      /^Creating RGL min mode launch: ([a-z0-9_]+)/i.exec(entry.message.trim())
    if (m) ids.push(m[1]!.toLowerCase())
  }
  return ids
}
