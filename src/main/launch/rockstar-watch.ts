import { EventEmitter } from 'node:events'
import { basename } from 'node:path'
import { isInsideFolder } from '../sources/rockstar-log'

/** What the Rockstar Games Launcher does for a game launched but not running yet. */
export type RockstarLaunchPhase = 'launcher' | 'waiting'

/** The launcher's state, read from the current `launcher.log`. */
export interface RockstarStatus {
  /** Executables started and not exited yet according to the log. */
  openSessions: string[]
  /** Title ids the launcher was asked to start since the given time. */
  requested: string[]
}

export interface RockstarWatchDeps {
  /** Reads the log; `since`: oldest launch still pending (launch requests after it). */
  readStatus: (since: number) => Promise<RockstarStatus>
  /**
   * Whether one of these executables runs (file names): a game the launcher lost track of
   * (launcher killed, crash) has no exit line. Absent: the log is trusted.
   */
  isRunning?: (images: string[]) => Promise<boolean>
  pollMs?: number
  pendingPollMs?: number
  /** How long a launch may stay in the same phase before Shelf stops waiting. */
  startTimeoutMs?: number
  now?: () => number
}

export interface RockstarTarget {
  titleId: string
  installPath: string
  /** Main executable of the catalogue (relative), checked with the one of the log. */
  executable?: string | null
}

interface Watched extends RockstarTarget {
  started: boolean
  phase: RockstarLaunchPhase | null
  since: number
  deadline: number
}

/**
 * Follows games handed to the Rockstar Games Launcher (`-minmodeApp`): Shelf does not own
 * their process, the launcher's log tells when it starts one and when it exits. Same events
 * as the Steam watcher: `phase` and `expired` while a launch is pending, `change` with the
 * games running, `ended` when one stops (its session is then read from the log).
 */
export class RockstarWatcher extends EventEmitter<{
  change: [number[]]
  ended: [number]
  phase: [number, RockstarLaunchPhase]
  expired: [number]
}> {
  private readonly watched = new Map<number, Watched>()
  private timer: NodeJS.Timeout | null = null
  private timerDelay = 0
  private polling = false
  private readonly pollMs: number
  private readonly pendingPollMs: number
  private readonly startTimeoutMs: number
  private readonly now: () => number

  constructor(private readonly deps: RockstarWatchDeps) {
    super()
    this.pollMs = deps.pollMs ?? 5_000
    this.pendingPollMs = deps.pendingPollMs ?? 1_000
    // The launcher may update the game before starting it: more room than for Steam.
    this.startTimeoutMs = deps.startTimeoutMs ?? 20 * 60_000
    this.now = deps.now ?? Date.now
  }

  runningIds(): number[] {
    return [...this.watched].filter(([, w]) => w.started).map(([id]) => id)
  }

  isRunning(gameId: number): boolean {
    return this.watched.get(gameId)?.started ?? false
  }

  /** Starts following a launch. False when there is nothing to wait for (already running). */
  watch(gameId: number, target: RockstarTarget): boolean {
    if (!target.installPath || this.isRunning(gameId)) return false
    const now = this.now()
    this.watched.set(gameId, {
      ...target,
      started: false,
      phase: null,
      // The log has a millisecond clock but a second may pass before the click is handled.
      since: now - 2_000,
      deadline: now + this.startTimeoutMs
    })
    this.schedule()
    return true
  }

  /** Stops waiting for a launch; a running game stays followed. */
  unwatch(gameId: number): void {
    if (this.watched.get(gameId)?.started === false) this.watched.delete(gameId)
    if (this.watched.size === 0) this.stop()
  }

  async poll(): Promise<void> {
    if (this.polling || this.watched.size === 0) return
    this.polling = true
    try {
      const since = Math.min(...[...this.watched.values()].map((w) => w.since))
      const status = await this.deps.readStatus(since)
      let changed = false
      const ended: number[] = []
      const phases: [number, RockstarLaunchPhase][] = []
      const expired: number[] = []
      for (const [gameId, entry] of this.watched) {
        const sessions = status.openSessions.filter((path) =>
          isInsideFolder(path, entry.installPath)
        )
        const alive = sessions.length > 0 && (await this.alive(sessions, entry))
        if (!entry.started) {
          if (alive) {
            entry.started = true
            changed = true
            continue
          }
          const phase: RockstarLaunchPhase = status.requested.includes(entry.titleId)
            ? 'waiting'
            : 'launcher'
          if (phase !== entry.phase) {
            entry.phase = phase
            entry.deadline = this.now() + this.startTimeoutMs
            phases.push([gameId, phase])
          } else if (this.now() > entry.deadline) {
            this.watched.delete(gameId)
            expired.push(gameId)
          }
        } else if (!alive) {
          this.watched.delete(gameId)
          ended.push(gameId)
          changed = true
        }
      }
      for (const [gameId, phase] of phases) this.emit('phase', gameId, phase)
      for (const gameId of expired) this.emit('expired', gameId)
      if (changed) this.emit('change', this.runningIds())
      for (const gameId of ended) this.emit('ended', gameId)
    } catch (error) {
      console.warn('[rockstar] status read failed', error)
    } finally {
      this.polling = false
      if (this.watched.size === 0) this.stop()
      else this.schedule()
    }
  }

  dispose(): void {
    this.watched.clear()
    this.stop()
  }

  private async alive(sessions: string[], entry: Watched): Promise<boolean> {
    if (!this.deps.isRunning) return true
    const images = new Set(sessions.map((path) => basename(path.replace(/\\/g, '/'))))
    if (entry.executable) images.add(basename(entry.executable.replace(/\\/g, '/')))
    return this.deps.isRunning([...images])
  }

  private schedule(): void {
    const pending = [...this.watched.values()].some((w) => !w.started)
    const delay = pending ? this.pendingPollMs : this.pollMs
    if (this.timer && this.timerDelay === delay) return
    this.stop()
    this.timerDelay = delay
    this.timer = setTimeout(() => {
      this.timer = null
      void this.poll()
    }, delay)
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
