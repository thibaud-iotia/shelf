import type { LaunchResult } from '../../shared/models'
import type { AppContext } from '../context'
import { getGameRow } from '../games/repository'
import { paths } from '../platform/paths'
import { buildLaunchPlan } from './plan'

/** Launches a game (detail page, palette, tray) and follows it when Shelf can. */
export async function launchGame(
  ctx: Pick<AppContext, 'database' | 'settings' | 'runner' | 'steamWatch'>,
  gameId: number
): Promise<LaunchResult> {
  const game = getGameRow(ctx.database.db, gameId)
  const plan = buildLaunchPlan(game, {
    platform: process.platform,
    runnerPath: ctx.settings.get('runnerPath'),
    protonPrefix: paths.protonPrefix()
  })
  const result = await ctx.runner.launch(game.id, plan)
  // Steam starts the game itself: watch its RunningAppID to know when the session ends.
  if (plan.kind === 'uri' && game.source === 'steam') {
    ctx.steamWatch.watch(game.id, Number(game.sourceId))
  }
  return result
}

/** Games running right now: processes Shelf started, and Steam games it follows. */
export function runningGameIds(ctx: Pick<AppContext, 'runner' | 'steamWatch'>): number[] {
  return [...ctx.runner.runningIds(), ...ctx.steamWatch.runningIds()]
}
