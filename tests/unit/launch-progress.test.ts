import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaunchProgress } from '../../src/shared/models'
import {
  formatElapsed,
  LAUNCH_STALL_MS,
  launchPhaseLabel,
  launchPhaseShortLabel,
  launchStallHint
} from '../../src/shared/launch'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import { createManualGame } from '../../src/main/games/repository'
import { validateGameInput } from '../../src/main/games/validation'
import { cancelLaunch, followSteamLaunches, launchGame } from '../../src/main/launch/launch-game'
import { launcherOf } from '../../src/main/launch/plan'
import { LaunchTracker } from '../../src/main/launch/progress'
import { GameRunner } from '../../src/main/launch/runner'
import { SteamWatcher } from '../../src/main/launch/steam-watch'
import { SettingsStore } from '../../src/main/settings/store'
import type { SteamStatus } from '../../src/main/sources/steam-running'
import { tempDir } from './helpers'

// paths.ts reads userData through electron's `app`.
vi.mock('electron', () => ({ app: { getPath: () => tempDir(), isPackaged: false } }))

const migrationsFolder = resolve(__dirname, '../../drizzle')

describe('launch wording', () => {
  it('names each phase after the launcher', () => {
    expect(launchPhaseLabel('starting', null)).toBe('Lancement…')
    expect(launchPhaseLabel('launcher', 'steam')).toBe('Démarrage de Steam…')
    expect(launchPhaseLabel('updating', 'steam')).toBe('Steam met à jour le jeu…')
    expect(launchPhaseLabel('waiting', 'steam')).toBe('Steam lance le jeu…')
    expect(launchPhaseLabel('handoff', 'epic')).toBe('Ouverture d’Epic Games…')
    expect(launchPhaseLabel('handoff', 'gog')).toBe('Ouverture de GOG Galaxy…')
    expect(launchPhaseShortLabel('launcher', 'steam')).toBe('Steam démarre…')
    expect(launchPhaseShortLabel('updating', 'steam')).toBe('Mise à jour…')
    expect(launchPhaseShortLabel('waiting', 'steam')).toBe('Lancement…')
    expect(launchPhaseShortLabel('handoff', 'epic')).toBe('Ouverture…')
  })

  it('suggests checking the launcher once a phase lasts', () => {
    const progress = { phase: 'waiting', launcher: 'steam', phaseSince: 0 } as const
    expect(launchStallHint(progress, LAUNCH_STALL_MS - 1)).toBeNull()
    expect(launchStallHint(progress, LAUNCH_STALL_MS)).toBe(
      'Rien ne se passe ? Vérifiez la fenêtre de Steam.'
    )
    expect(launchStallHint({ ...progress, phase: 'updating' }, LAUNCH_STALL_MS * 10)).toBeNull()
    expect(launchStallHint({ ...progress, launcher: null }, LAUNCH_STALL_MS)).toBe(
      'Le jeu met du temps à démarrer…'
    )
  })

  it('formats the elapsed time', () => {
    expect(formatElapsed(-5)).toBe('0 s')
    expect(formatElapsed(4_900)).toBe('4 s')
    expect(formatElapsed(65_000)).toBe('1 min 05')
  })
})

describe('LaunchTracker', () => {
  afterEach(() => vi.useRealTimers())

  it('follows a launch from the click to its end', () => {
    let now = 1_000
    const tracker = new LaunchTracker({ now: () => now })
    const changes: LaunchProgress[][] = []
    tracker.on('change', (list) => changes.push(list))

    tracker.begin(3, 'steam')
    expect(() => tracker.begin(3, 'steam')).toThrow('déjà en cours')
    now = 2_000
    tracker.setPhase(3, 'launcher')
    tracker.setPhase(3, 'launcher') // unchanged: no event
    tracker.setPhase(99, 'waiting') // unknown: ignored
    expect(tracker.get(3)).toEqual({
      gameId: 3,
      phase: 'launcher',
      launcher: 'steam',
      startedAt: 1_000,
      phaseSince: 2_000
    })
    tracker.finish(3)
    tracker.finish(3)
    expect(changes.map((list) => list.map((l) => l.phase))).toEqual([
      ['starting'],
      ['launcher'],
      []
    ])
  })

  it('shows a hand-off for a moment', () => {
    vi.useFakeTimers()
    const tracker = new LaunchTracker({ handoffMs: 5_000 })
    tracker.begin(4, 'epic')
    tracker.handoff(4)
    expect(tracker.get(4)?.phase).toBe('handoff')
    vi.advanceTimersByTime(4_999)
    expect(tracker.list()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(tracker.list()).toEqual([])
  })
})

describe('launchGame', () => {
  let handle: DatabaseHandle
  let opened: string[]
  let status: SteamStatus
  let tracker: LaunchTracker
  let steamWatch: SteamWatcher
  let runner: GameRunner
  let timeouts: number[]
  let clock: number

  beforeEach(() => {
    vi.stubEnv('SHELF_LAUNCHER_ROOT', tempDir()) // no launcher: Steam games go through the URI
    handle = openDatabase(':memory:', migrationsFolder)
    opened = []
    timeouts = []
    clock = 0
    status = { runningAppId: 0, clientRunning: false, updatingAppIds: [] }
    runner = new GameRunner({
      openExternal: async (uri) => {
        opened.push(uri)
      },
      onStart: () => 1,
      onExit: () => {}
    })
    tracker = new LaunchTracker({ handoffMs: 60_000 })
    steamWatch = new SteamWatcher({
      readStatus: async () => status,
      pollMs: 3_600_000,
      pendingPollMs: 3_600_000,
      startTimeoutMs: 1_000,
      now: () => clock
    })
    followSteamLaunches(tracker, steamWatch, (gameId) => timeouts.push(gameId))
  })

  afterEach(() => {
    runner.dispose()
    steamWatch.dispose()
    tracker.dispose()
    handle.close()
    vi.unstubAllEnvs()
  })

  const ctx = () => ({
    database: handle,
    settings: new SettingsStore(handle.db),
    runner,
    steamWatch,
    launches: tracker
  })

  const addGame = (source: 'steam' | 'epic', sourceId: string) =>
    handle.db
      .insert(games)
      .values({ title: 'Hades', source, sourceId, installState: 'installed' })
      .returning()
      .get().id

  it('follows a Steam launch until the game runs', async () => {
    const id = addGame('steam', '1145360')
    const result = await launchGame(ctx(), id)
    expect(result).toEqual({ tracked: false, method: 'uri' })
    expect(opened).toEqual(['steam://rungameid/1145360'])
    expect(tracker.get(id)?.phase).toBe('starting')
    await expect(launchGame(ctx(), id)).rejects.toThrow('déjà en cours')

    await steamWatch.poll() // Steam closed: it starts first
    expect(tracker.get(id)).toMatchObject({ phase: 'launcher', launcher: 'steam' })
    status = { runningAppId: 0, clientRunning: true, updatingAppIds: [1145360] }
    await steamWatch.poll()
    expect(tracker.get(id)?.phase).toBe('updating')
    status = { runningAppId: 1145360, clientRunning: true, updatingAppIds: [] }
    await steamWatch.poll()
    expect(tracker.get(id)).toBeNull()
    expect(steamWatch.runningIds()).toEqual([id])
  })

  it('stops waiting when the user cancels, and tells when the game never shows up', async () => {
    const first = addGame('steam', '620')
    await launchGame(ctx(), first)
    cancelLaunch(ctx(), first)
    expect(tracker.list()).toEqual([])

    const second = addGame('steam', '70')
    await launchGame(ctx(), second)
    await steamWatch.poll()
    clock = 2_000
    await steamWatch.poll()
    expect(tracker.list()).toEqual([])
    expect(timeouts).toEqual([second])
  })

  it('hands Epic games off, and ends right away for processes Shelf starts', async () => {
    const epic = addGame('epic', 'Fortnite')
    await launchGame(ctx(), epic)
    expect(tracker.get(epic)?.phase).toBe('handoff')

    const manual = createManualGame(
      handle.db,
      validateGameInput({ title: 'Node', executablePath: process.execPath, launchArgs: '-e "1"' })
    )
    expect(launcherOf({ source: 'manual', executablePath: process.execPath })).toBeNull()
    const result = await launchGame(ctx(), manual.id)
    expect(result.tracked).toBe(true)
    expect(tracker.get(manual.id)).toBeNull()
  })

  it('clears the launch when it fails', async () => {
    const manual = createManualGame(
      handle.db,
      validateGameInput({ title: 'Gone', executablePath: process.execPath })
    )
    handle.db
      .update(games)
      .set({ executablePath: resolve('/nope/missing.exe') })
      .run()
    await expect(launchGame(ctx(), manual.id)).rejects.toThrow('introuvable')
    expect(tracker.list()).toEqual([])
  })
})
