import type { GameSourceId } from '../../shared/domain'
import type { LaunchResult } from '../../shared/models'
import type { AppContext } from '../context'
import { getGameRow } from '../games/repository'
import { launcherLocations, paths } from '../platform/paths'
import { buildLaunchPlan, launcherOf } from './plan'
import type { LaunchTracker } from './progress'
import type { SteamWatcher } from './steam-watch'

type LaunchContext = Pick<
  AppContext,
  'database' | 'settings' | 'runner' | 'steamWatch' | 'launches'
>

/**
 * Launches a game (detail page, palette, tray) and follows it when Shelf can. The launch is
 * tracked from the click: the UI shows where it stands until the game runs.
 */
export async function launchGame(ctx: LaunchContext, gameId: number): Promise<LaunchResult> {
  const game = getGameRow(ctx.database.db, gameId)
  ctx.launches.begin(game.id, launcherOf(game))
  let result: LaunchResult
  try {
    const plan = buildLaunchPlan(game, {
      platform: process.platform,
      steamExecutable: game.source === 'steam' ? await launcherLocations().steamExecutable() : null,
      runnerPath: ctx.settings.get('runnerPath'),
      protonPrefix: paths.protonPrefix()
    })
    result = await ctx.runner.launch(game.id, plan)
  } catch (error) {
    ctx.launches.finish(game.id)
    throw error
  }

  // Steam starts the game itself: its state tells the phases, then when the session ends.
  if (!result.tracked && game.source === 'steam') {
    if (ctx.steamWatch.watch(game.id, Number(game.sourceId))) return result
  }
  // Shelf owns the process (the running badge takes over), or Steam just brings a running
  // game to the front; otherwise the launcher took over where Shelf cannot follow it.
  if (result.tracked || ctx.steamWatch.isRunning(game.id)) ctx.launches.finish(game.id)
  else ctx.launches.handoff(game.id)
  return result
}

/** Stops waiting for a launch; the launcher goes on on its own. */
export function cancelLaunch(
  ctx: Pick<AppContext, 'steamWatch' | 'launches'>,
  gameId: number
): void {
  ctx.steamWatch.unwatch(gameId)
  ctx.launches.finish(gameId)
}

/** Keeps the launches in step with Steam: phases, game started, never showed up. */
export function followSteamLaunches(
  launches: LaunchTracker,
  steamWatch: SteamWatcher,
  onTimeout: (gameId: number, launcher: GameSourceId | null) => void
): void {
  steamWatch.on('phase', (gameId, phase) => launches.setPhase(gameId, phase))
  steamWatch.on('change', (ids) => {
    for (const gameId of ids) launches.finish(gameId)
  })
  steamWatch.on('expired', (gameId) => {
    const launch = launches.get(gameId)
    if (!launch) return
    launches.finish(gameId)
    onTimeout(gameId, launch.launcher)
  })
}

/** Games running right now: processes Shelf started, and Steam games it follows. */
export function runningGameIds(ctx: Pick<AppContext, 'runner' | 'steamWatch'>): number[] {
  return [...ctx.runner.runningIds(), ...ctx.steamWatch.runningIds()]
}
