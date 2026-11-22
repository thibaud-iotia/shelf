import { and, eq, gt, isNotNull, lt } from 'drizzle-orm'
import { rockstarTitle } from '../../shared/rockstar'
import type { ShelfDatabase } from '../db/client'
import { games, playSessions } from '../db/schema'
import { isInsideFolder, type RockstarSession } from '../sources/rockstar-log'

/** Sessions shorter than this are launch failures, not play. */
const MIN_SESSION_MS = 30_000

/**
 * Turns the game runs of the Rockstar Games Launcher's log into play sessions. The launcher
 * keeps no playtime anywhere Shelf can read, but its log has the exact start and exit of each
 * run, including the games started from the launcher itself. Idempotent: a run overlapping a
 * session already stored (imported before, or measured by Shelf) is skipped.
 * Returns the number of sessions added.
 */
export function importRockstarSessions(db: ShelfDatabase, sessions: RockstarSession[]): number {
  const rows = db
    .select({ id: games.id, sourceId: games.sourceId, installPath: games.installPath })
    .from(games)
    .where(and(eq(games.source, 'rockstar'), isNotNull(games.installPath)))
    .all()
  if (!rows.length) return 0

  const gameOf = (path: string) =>
    rows.find((row) => isInsideFolder(path, row.installPath!)) ??
    // Moved install: the executable's name still tells the game.
    rows.find((row) => {
      const exe = rockstarTitle(row.sourceId)?.executable.split('\\').pop()?.toLowerCase()
      return !!exe && path.toLowerCase().endsWith(`\\${exe}`)
    })

  let added = 0
  db.transaction((tx) => {
    for (const session of sessions) {
      const { startedAt, endedAt } = session
      if (endedAt === null || endedAt - startedAt < MIN_SESSION_MS) continue
      const game = gameOf(session.path)
      if (!game) continue
      const overlapping = tx
        .select({ id: playSessions.id })
        .from(playSessions)
        .where(
          and(
            eq(playSessions.gameId, game.id),
            lt(playSessions.startedAt, new Date(endedAt)),
            gt(playSessions.endedAt, new Date(startedAt))
          )
        )
        .get()
      if (overlapping) continue
      tx.insert(playSessions)
        .values({
          gameId: game.id,
          startedAt: new Date(startedAt),
          endedAt: new Date(endedAt),
          durationSec: Math.round((endedAt - startedAt) / 1000)
        })
        .run()
      added++
    }
  })
  return added
}
