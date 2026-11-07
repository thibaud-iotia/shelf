import { EventEmitter } from 'node:events'
import type { SteamStatus } from '../sources/steam-running'

/** What Steam is doing for a game launched but not running yet. */
export type SteamLaunchPhase = 'launcher' | 'updating' | 'waiting'

export interface SteamWatchDeps {
  /** Steam's state; `appIds`: games being launched, whose update flag is wanted. */
  readStatus: (appIds: number[]) => Promise<SteamStatus>
  /** Polling while games run. */
  pollMs?: number
  /** Polling while a launch is pending, so the UI follows Steam closely. */
  pendingPollMs?: number
  /** How long a launch may stay in the same phase before Shelf stops waiting (updates never expire). */
  startTimeoutMs?: number
  now?: () => number
}

interface Watched {
  appId: number
  started: boolean
  phase: SteamLaunchPhase | null
  deadline: number
}

/**
 * Follows games launched through `steam://`: Shelf does not own their process, so it polls
 * Steam's state. While a launch is pending it emits `phase` (Steam starting, updating the game,
 * starting it) and `expired` if the game never shows up; then `change` with the ids of the
 * Steam games running, and `ended` when one of them stops (Steam then updates its playtime).
 */
export class SteamWatcher extends EventEmitter<{
  change: [number[]]
  ended: [number]
  phase: [number, SteamLaunchPhase]
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

  constructor(private readonly deps: SteamWatchDeps) {
    super()
    this.pollMs = deps.pollMs ?? 5_000
    this.pendingPollMs = deps.pendingPollMs ?? 1_000
    this.startTimeoutMs = deps.startTimeoutMs ?? 10 * 60_000
    this.now = deps.now ?? Date.now
  }

  runningIds(): number[] {
    return [...this.watched].filter(([, w]) => w.started).map(([id]) => id)
  }

  isRunning(gameId: number): boolean {
    return this.watched.get(gameId)?.started ?? false
  }

  /** Starts following a launch. False when there is nothing to wait for (invalid id, already running). */
  watch(gameId: number, appId: number): boolean {
    if (!Number.isInteger(appId) || appId <= 0) return false
    if (this.isRunning(gameId)) return false
    this.watched.set(gameId, {
      appId,
      started: false,
      phase: null,
      deadline: this.now() + this.startTimeoutMs
    })
    this.schedule()
    return true
  }

  /** Stops waiting for a launch (the user gave up); a running game stays followed. */
  unwatch(gameId: number): void {
    if (this.watched.get(gameId)?.started === false) this.watched.delete(gameId)
    if (this.watched.size === 0) this.stop()
  }

  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const pending = [...this.watched.values()].filter((w) => !w.started).map((w) => w.appId)
      const status = await this.deps.readStatus(pending)
      const running = status.runningAppId
      let changed = false
      const ended: number[] = []
      const phases: [number, SteamLaunchPhase][] = []
      const expired: number[] = []
      for (const [gameId, entry] of this.watched) {
        if (!entry.started) {
          if (running === entry.appId) {
            entry.started = true
            changed = true
            continue
          }
          const phase: SteamLaunchPhase = status.updatingAppIds.includes(entry.appId)
            ? 'updating'
            : status.clientRunning === false
              ? 'launcher'
              : 'waiting'
          // Progress (or an update, however long) pushes the deadline back.
          if (phase !== entry.phase || phase === 'updating') {
            entry.deadline = this.now() + this.startTimeoutMs
          }
          if (phase !== entry.phase) {
            entry.phase = phase
            phases.push([gameId, phase])
          } else if (this.now() > entry.deadline) {
            this.watched.delete(gameId)
            expired.push(gameId)
          }
        } else if (running !== null && running !== entry.appId) {
          this.watched.delete(gameId)
          ended.push(gameId)
          changed = true
        }
      }
      for (const [gameId, phase] of phases) this.emit('phase', gameId, phase)
      for (const gameId of expired) this.emit('expired', gameId)
      if (changed) this.emit('change', this.runningIds())
      for (const gameId of ended) this.emit('ended', gameId)
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

  /** Next poll: soon while a launch is pending, relaxed once every game runs. */
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
