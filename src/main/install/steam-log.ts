// Steam's appmanifest only gets the bytes downloaded when a download stops (pause, end): read
// alone, a running download stays at 0 %. Steam's content log tells, as soon as a download
// (re)starts, its sizes and what has been done already, then each step it goes through:
//   [2026-11-13 16:58:50] AppID 431240 update started : download 0/4580010288, store 0/0, reuse 0/0, delta 0/0, stage 0/6018004668
//   [2026-11-13 16:58:50] AppID 431240 App update changed : Running Update,Downloading,Staging,
//   [2026-11-13 16:59:36] AppID 431240 update canceled : Disabled (Suspended)
//   [2026-11-13 16:55:17] AppID 431240 finished update, 1 mounted depots (BuildID 20236533) : …
// The bytes in between come from the Steam process itself (see platform/process-io.ts).

import { open } from 'node:fs/promises'
import { join } from 'node:path'

export type SteamDownloadStep = 'preallocating' | 'downloading' | 'finishing'

export interface SteamLogDownload {
  /** Time stamp of the "update started" line: one download run (a resume starts a new one). */
  run: string
  /** Compressed bytes, as Steam's downloads page counts them. */
  downloaded: number
  total: number
  /** Bytes written to disk (uncompressed) and to write. */
  staged: number
  stageTotal: number
  /** Started and neither stopped nor finished since. */
  active: boolean
  step: SteamDownloadStep | null
}

const LINE = /^\[([^\]]+)\] AppID (\d+) (.*)$/
const STARTED = /^update started : download (\d+)\/(\d+).*?stage (\d+)\/(\d+)/
const CHANGED = /^App update changed : (.*)$/

function stepOf(flags: string): SteamDownloadStep | null {
  const set = new Set(flags.split(',').map((flag) => flag.trim().toLowerCase()))
  if (set.has('committing') || set.has('verifying install') || set.has('verifying update')) {
    return 'finishing'
  }
  if (set.has('downloading') || set.has('staging')) return 'downloading'
  if (set.has('preallocating') || set.has('reconfiguring')) return 'preallocating'
  return null
}

/** The last download run of `appId` in (the tail of) content_log.txt; null when none. */
export function readSteamDownload(log: string, appId: number): SteamLogDownload | null {
  let download: SteamLogDownload | null = null
  let step: SteamDownloadStep | null = null
  for (const line of log.split(/\r?\n/)) {
    const match = LINE.exec(line)
    if (!match || Number(match[2]) !== appId) continue
    const [, time, , event] = match as unknown as [string, string, string, string]
    const started = STARTED.exec(event)
    if (started) {
      const [, downloaded, total, staged, stageTotal] = started.map(Number) as number[]
      download = {
        run: time,
        downloaded: downloaded!,
        total: total!,
        staged: staged!,
        stageTotal: stageTotal!,
        active: true,
        step: 'downloading'
      }
      continue
    }
    const changed = CHANGED.exec(event)
    if (changed) {
      step = stepOf(changed[1]!)
      if (download?.active && step) download.step = step
      continue
    }
    if (download && /^(update canceled|finished update)/.test(event)) download.active = false
  }
  // A run being prepared (preallocation) logs its "update started" line only afterwards.
  if (step === 'preallocating' && (!download || !download.active)) {
    return {
      run: '',
      downloaded: download?.downloaded ?? 0,
      total: download?.total ?? 0,
      staged: download?.staged ?? 0,
      stageTotal: download?.stageTotal ?? 0,
      active: true,
      step
    }
  }
  return download
}

/** content_log.txt of a Steam install. */
export function steamContentLog(root: string): string {
  return join(root, 'logs', 'content_log.txt')
}

/** Last `bytes` of a text file (from a line start); null when unreadable. */
export async function readTail(path: string, bytes = 256 * 1024): Promise<string | null> {
  let file: Awaited<ReturnType<typeof open>> | null = null
  try {
    file = await open(path, 'r')
    const { size } = await file.stat()
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    await file.read(buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } catch {
    return null
  } finally {
    await file?.close()
  }
}

export interface SteamWriteSample {
  /** Steam client process: its counter starts over when Steam restarts. */
  pid: number
  /** Bytes the process wrote since it started. */
  written: number
}

interface Baseline {
  run: string
  pid: number
  written: number
}

/**
 * Live progress of a Steam download between two checkpoints of the content log: what the log
 * said was staged when the run started, plus what the Steam process wrote since. Steam
 * preallocates files without writing them, so the bytes written follow the download closely.
 * Never goes backwards and stays under 100 % until Steam marks the game installed.
 */
export class SteamProgressEstimator {
  private baseline: Baseline | null = null
  private best = 0

  estimate(download: SteamLogDownload, sample: SteamWriteSample | null): number | null {
    const total = download.stageTotal || download.total
    if (!total) return this.best || null
    const done = download.stageTotal ? download.staged : download.downloaded
    let staged = done
    if (download.active && download.step === 'downloading' && sample) {
      const base = this.baseline
      if (!base || base.run !== download.run || base.pid !== sample.pid) {
        this.baseline = { run: download.run, pid: sample.pid, written: sample.written }
      } else {
        staged += Math.max(0, sample.written - base.written)
      }
    }
    const ratio = download.step === 'finishing' ? 0.99 : Math.min(staged / total, 0.99)
    this.best = Math.max(this.best, ratio)
    return this.best
  }

  /** A checkpoint known otherwise (the manifest after a pause). */
  atLeast(ratio: number): number {
    this.best = Math.max(this.best, Math.min(ratio, 0.99))
    return this.best
  }
}
