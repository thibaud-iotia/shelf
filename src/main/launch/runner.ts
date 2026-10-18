import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { AppError } from '../../shared/errors'
import type { LaunchResult } from '../../shared/models'
import type { LaunchPlan } from './plan'

export interface RunnerDeps {
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  openExternal: (uri: string) => Promise<void>
  now?: () => Date
  /** Called when a tracked process starts; returns the session id. */
  onStart: (gameId: number, startedAt: Date) => number
  onExit: (gameId: number, sessionId: number, endedAt: Date) => void
}

interface Running {
  child: ChildProcess
  sessionId: number
}

/**
 * Starts games and follows the processes it owns. Emits `change` with the ids of the
 * games currently running whenever that set changes.
 */
export class GameRunner extends EventEmitter<{ change: [number[]] }> {
  private readonly running = new Map<number, Running>()
  private readonly spawnFn: NonNullable<RunnerDeps['spawn']>
  private readonly now: () => Date

  constructor(private readonly deps: RunnerDeps) {
    super()
    this.spawnFn = deps.spawn ?? spawn
    this.now = deps.now ?? (() => new Date())
  }

  runningIds(): number[] {
    return [...this.running.keys()]
  }

  isRunning(gameId: number): boolean {
    return this.running.has(gameId)
  }

  async launch(gameId: number, plan: LaunchPlan): Promise<LaunchResult> {
    if (plan.kind === 'uri') {
      await this.deps.openExternal(plan.uri)
      return { tracked: false, method: 'uri' }
    }
    if (this.running.has(gameId)) {
      throw new AppError('VALIDATION', 'Ce jeu est déjà en cours d’exécution.')
    }
    if (isAbsolute(plan.command) && !existsSync(plan.command)) {
      throw new AppError('NOT_FOUND', `Exécutable introuvable : ${plan.command}`)
    }

    const child = this.spawnFn(plan.command, plan.args, {
      cwd: existsSync(plan.cwd) ? plan.cwd : undefined,
      detached: true,
      stdio: 'ignore',
      env: plan.env ? { ...process.env, ...plan.env } : process.env
    })

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', (error) =>
        reject(new AppError('INTERNAL', `Impossible de lancer le jeu : ${error.message}`))
      )
    })
    child.unref()

    const sessionId = this.deps.onStart(gameId, this.now())
    this.running.set(gameId, { child, sessionId })
    this.emit('change', this.runningIds())

    child.once('exit', () => this.finish(gameId))
    return { tracked: true, method: 'process' }
  }

  /** Closes the open sessions (Shelf is quitting; the games keep running on their own). */
  dispose(): void {
    for (const gameId of [...this.running.keys()]) this.finish(gameId)
  }

  private finish(gameId: number): void {
    const entry = this.running.get(gameId)
    if (!entry) return
    this.running.delete(gameId)
    this.deps.onExit(gameId, entry.sessionId, this.now())
    this.emit('change', this.runningIds())
  }
}
