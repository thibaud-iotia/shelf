import { existsSync } from 'node:fs'

export interface WatchedGameState {
  installState: string
  executablePath: string | null
}

export interface UninstallWatchDeps {
  /** Re-reads the launchers' files (install states). */
  refresh: () => Promise<void>
  /** Current row of the game, null once it left the library. */
  state: (gameId: number) => WatchedGameState | null
  /** Marks a game whose executable disappeared as no longer installed. */
  markUninstalled: (gameId: number) => void
  /** The library changed: the game is no longer installed. */
  onUninstalled: (gameId: number) => void
  exists?: (path: string) => boolean
  pollMs?: number
  /** How long the user may take to confirm the uninstall in the launcher / uninstaller. */
  timeoutMs?: number
  now?: () => number
}

/**
 * Follows the games whose uninstall Shelf started: the launcher (or the game's uninstaller)
 * does it on its own, after a confirmation. The launchers are re-read until the game is seen
 * uninstalled, so the library updates without a manual "Vérifier".
 */
export class UninstallWatcher {
  private readonly watched = new Map<number, number>()
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private readonly pollMs: number
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly exists: (path: string) => boolean

  constructor(private readonly deps: UninstallWatchDeps) {
    this.pollMs = deps.pollMs ?? 4_000
    this.timeoutMs = deps.timeoutMs ?? 15 * 60_000
    this.now = deps.now ?? Date.now
    this.exists = deps.exists ?? existsSync
  }

  watching(): number[] {
    return [...this.watched.keys()]
  }

  watch(gameId: number): void {
    this.watched.set(gameId, this.now() + this.timeoutMs)
    this.timer ??= setInterval(() => void this.poll(), this.pollMs)
  }

  async poll(): Promise<void> {
    if (this.polling || this.watched.size === 0) return
    this.polling = true
    try {
      try {
        await this.deps.refresh()
      } catch (error) {
        console.warn('[uninstall-watch] refresh failed', error)
      }
      for (const [gameId, deadline] of this.watched) {
        const row = this.deps.state(gameId)
        if (!row) {
          this.watched.delete(gameId)
        } else if (row.installState !== 'installed') {
          this.watched.delete(gameId)
          this.deps.onUninstalled(gameId)
        } else if (row.executablePath && !this.exists(row.executablePath)) {
          // Manual games: no launcher file to re-read, the executable is the only witness.
          this.deps.markUninstalled(gameId)
          this.watched.delete(gameId)
          this.deps.onUninstalled(gameId)
        } else if (this.now() > deadline) {
          this.watched.delete(gameId)
        }
      }
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
