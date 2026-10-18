import { EventEmitter } from 'node:events'

export interface SteamWatchDeps {
  /** Steam's RunningAppID: 0 when no game runs, null when unreadable. */
  readRunningAppId: () => Promise<number | null>
  pollMs?: number
  /** How long a launched game may take to start (updates, shader compilation…). */
  startTimeoutMs?: number
  now?: () => number
}

interface Watched {
  appId: number
  started: boolean
  deadline: number
}

/**
 * Follows games launched through `steam://`: Shelf does not own their process, so it polls
 * Steam's RunningAppID. Emits `change` with the ids of the Steam games running, and `ended`
 * when one of them stops (Steam then updates its playtime).
 */
export class SteamWatcher extends EventEmitter<{ change: [number[]]; ended: [number] }> {
  private readonly watched = new Map<number, Watched>()
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private readonly pollMs: number
  private readonly startTimeoutMs: number
  private readonly now: () => number

  constructor(private readonly deps: SteamWatchDeps) {
    super()
    this.pollMs = deps.pollMs ?? 5_000
    this.startTimeoutMs = deps.startTimeoutMs ?? 10 * 60_000
    this.now = deps.now ?? Date.now
  }

  runningIds(): number[] {
    return [...this.watched].filter(([, w]) => w.started).map(([id]) => id)
  }

  watch(gameId: number, appId: number): void {
    if (!Number.isInteger(appId) || appId <= 0) return
    if (this.watched.get(gameId)?.started) return
    this.watched.set(gameId, { appId, started: false, deadline: this.now() + this.startTimeoutMs })
    this.timer ??= setInterval(() => void this.poll(), this.pollMs)
  }

  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const running = await this.deps.readRunningAppId()
      let changed = false
      const ended: number[] = []
      for (const [gameId, entry] of this.watched) {
        if (!entry.started) {
          if (running === entry.appId) {
            entry.started = true
            changed = true
          } else if (this.now() > entry.deadline) {
            this.watched.delete(gameId)
          }
        } else if (running !== null && running !== entry.appId) {
          this.watched.delete(gameId)
          ended.push(gameId)
          changed = true
        }
      }
      if (changed) this.emit('change', this.runningIds())
      for (const gameId of ended) this.emit('ended', gameId)
    } finally {
      this.polling = false
      if (this.watched.size === 0) this.stop()
    }
  }

  dispose(): void {
    this.watched.clear()
    this.stop()
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
