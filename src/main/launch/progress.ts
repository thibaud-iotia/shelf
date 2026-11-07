import { EventEmitter } from 'node:events'
import type { GameSourceId } from '../../shared/domain'
import { AppError } from '../../shared/errors'
import type { LaunchPhase, LaunchProgress } from '../../shared/models'

export interface LaunchTrackerDeps {
  now?: () => number
  /** How long a hand-off to a launcher Shelf cannot follow stays shown. */
  handoffMs?: number
}

/**
 * Launches between the click on "Jouer" and the game running, so the UI can tell the user
 * where things stand (Steam starting in the tray can take a while). Emits `change` with the
 * whole list whenever a launch starts, changes phase or ends.
 */
export class LaunchTracker extends EventEmitter<{ change: [LaunchProgress[]] }> {
  private readonly launches = new Map<number, LaunchProgress>()
  private readonly timers = new Map<number, NodeJS.Timeout>()
  private readonly now: () => number
  private readonly handoffMs: number

  constructor(deps: LaunchTrackerDeps = {}) {
    super()
    this.now = deps.now ?? Date.now
    this.handoffMs = deps.handoffMs ?? 20_000
  }

  list(): LaunchProgress[] {
    return [...this.launches.values()]
  }

  get(gameId: number): LaunchProgress | null {
    return this.launches.get(gameId) ?? null
  }

  /** First step of a launch; refuses a second click while the first one is still in progress. */
  begin(gameId: number, launcher: GameSourceId | null): void {
    if (this.launches.has(gameId)) {
      throw new AppError('VALIDATION', 'Le lancement de ce jeu est déjà en cours.')
    }
    const now = this.now()
    this.launches.set(gameId, {
      gameId,
      phase: 'starting',
      launcher,
      startedAt: now,
      phaseSince: now
    })
    this.emitChange()
  }

  setPhase(gameId: number, phase: LaunchPhase): void {
    const launch = this.launches.get(gameId)
    if (!launch || launch.phase === phase) return
    this.launches.set(gameId, { ...launch, phase, phaseSince: this.now() })
    this.emitChange()
  }

  /** The launcher took over and Shelf cannot follow it: shown for a moment, then done. */
  handoff(gameId: number): void {
    if (!this.launches.has(gameId)) return
    this.setPhase(gameId, 'handoff')
    this.clearTimer(gameId)
    this.timers.set(
      gameId,
      setTimeout(() => this.finish(gameId), this.handoffMs)
    )
  }

  /** The game runs, failed to start, or the user stopped waiting. */
  finish(gameId: number): void {
    this.clearTimer(gameId)
    if (this.launches.delete(gameId)) this.emitChange()
  }

  dispose(): void {
    for (const gameId of [...this.timers.keys()]) this.clearTimer(gameId)
    this.launches.clear()
  }

  private clearTimer(gameId: number): void {
    const timer = this.timers.get(gameId)
    if (timer) clearTimeout(timer)
    this.timers.delete(gameId)
  }

  private emitChange(): void {
    this.emit('change', this.list())
  }
}
