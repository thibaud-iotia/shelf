import type { GameSourceId } from '../../shared/domain'
import type { LaunchResult } from '../../shared/models'
import { rockstarTitle } from '../../shared/rockstar'
import type { AppContext } from '../context'
import { getGameRow } from '../games/repository'
import { legendaryOwnerOf } from '../install/legendary'
import { launcherLocations, paths, type LauncherLocations } from '../platform/paths'
import { epicLauncherHas } from '../sources/epic'
import { buildLaunchPlan, launcherOf } from './plan'
import type { LaunchTracker } from './progress'
import type { RockstarWatcher } from './rockstar-watch'
import type { SteamWatcher } from './steam-watch'

type LaunchContext = Pick<
  AppContext,
  'database' | 'settings' | 'runner' | 'steamWatch' | 'launches'
> &
  Partial<Pick<AppContext, 'rockstarWatch'>>

/**
 * Launches a game (detail page, palette, tray) and follows it when Shelf can. The launch is
 * tracked from the click: the UI shows where it stands until the game runs.
 */
export async function launchGame(ctx: LaunchContext, gameId: number): Promise<LaunchResult> {
  const game = getGameRow(ctx.database.db, gameId)
  ctx.launches.begin(game.id, launcherOf(game))
  let result: LaunchResult
  try {
    const locations = launcherLocations()
    const plan = buildLaunchPlan(game, {
      platform: process.platform,
      steamExecutable: game.source === 'steam' ? await locations.steamExecutable() : null,
      legendary: game.source === 'epic' ? await legendaryLaunchFor(game.sourceId, locations) : null,
      rockstarLauncher: game.source === 'rockstar' ? await locations.rockstarLauncher() : null,
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
  // The Rockstar Games Launcher logs the game it starts and when it exits.
  if (!result.tracked && game.source === 'rockstar' && game.installPath && ctx.rockstarWatch) {
    const target = {
      titleId: game.sourceId,
      installPath: game.installPath,
      executable: rockstarTitle(game.sourceId)?.executable ?? null
    }
    if (ctx.rockstarWatch.watch(game.id, target)) return result
  }
  // Shelf owns the process (the running badge takes over), or Steam just brings a running
  // game to the front; otherwise the launcher took over where Shelf cannot follow it.
  const followed = ctx.steamWatch.isRunning(game.id) || !!ctx.rockstarWatch?.isRunning(game.id)
  if (result.tracked || followed) ctx.launches.finish(game.id)
  else ctx.launches.handoff(game.id)
  return result
}

/**
 * Windows: an Epic game the Epic Games Launcher does not have but a Legendary installed
 * (from Shelf or Heroic) starts through that Legendary. Elsewhere Heroic's URI already does.
 */
async function legendaryLaunchFor(
  appName: string,
  locations: LauncherLocations
): Promise<{ file: string; configPath?: string } | null> {
  if (process.platform !== 'win32') return null
  if (await epicLauncherHas(locations.epicManifestDirs, appName)) return null
  return legendaryOwnerOf(appName, locations.legendaryBinaries)
}

/** Stops waiting for a launch; the launcher goes on on its own. */
export function cancelLaunch(
  ctx: Pick<AppContext, 'steamWatch' | 'launches'> & Partial<Pick<AppContext, 'rockstarWatch'>>,
  gameId: number
): void {
  ctx.steamWatch.unwatch(gameId)
  ctx.rockstarWatch?.unwatch(gameId)
  ctx.launches.finish(gameId)
}

/**
 * Keeps the launches in step with a launcher Shelf follows (Steam, Rockstar Games Launcher):
 * phases, game started, never showed up.
 */
export function followSteamLaunches(
  launches: LaunchTracker,
  watcher: SteamWatcher | RockstarWatcher,
  onTimeout: (gameId: number, launcher: GameSourceId | null) => void
): void {
  // Both watchers emit the same events; the union of their emitters is not callable as is.
  const steamWatch = watcher as SteamWatcher
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

/** Games running right now: processes Shelf started, Steam and Rockstar games it follows. */
export function runningGameIds(
  ctx: Pick<AppContext, 'runner' | 'steamWatch'> & Partial<Pick<AppContext, 'rockstarWatch'>>
): number[] {
  return [
    ...ctx.runner.runningIds(),
    ...ctx.steamWatch.runningIds(),
    ...(ctx.rockstarWatch?.runningIds() ?? [])
  ]
}
