import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { AppError } from '../../shared/errors'
import type { Game, GameDetail, GameInput, GamePatch, PlaySession } from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { collectionGames, gameDlcs, gameTags, games, playSessions, tags } from '../db/schema'
import { mediaUrl } from '../media/urls'
import { installUri, uninstallUri } from '../sources/uris'

export type GameRow = typeof games.$inferSelect

interface SessionStats {
  playtimeSec: number
  lastPlayedAt: number | null
  lastSessionSec: number | null
  sessionCount: number
}

const NO_STATS: SessionStats = {
  playtimeSec: 0,
  lastPlayedAt: null,
  lastSessionSec: null,
  sessionCount: 0
}

function sessionStats(db: ShelfDatabase, gameIds?: number[]): Map<number, SessionStats> {
  const scope = gameIds ? inArray(playSessions.gameId, gameIds) : undefined
  const totals = db
    .select({
      gameId: playSessions.gameId,
      total: sql<number>`coalesce(sum(${playSessions.durationSec}), 0)`,
      last: sql<number | null>`max(${playSessions.startedAt})`,
      count: sql<number>`count(*)`
    })
    .from(playSessions)
    .where(and(isNotNull(playSessions.endedAt), scope))
    .groupBy(playSessions.gameId)
    .all()

  const stats = new Map<number, SessionStats>()
  for (const row of totals) {
    stats.set(row.gameId, {
      playtimeSec: row.total,
      lastPlayedAt: row.last,
      lastSessionSec: null,
      sessionCount: row.count
    })
  }

  // Duration of each game's most recent finished session.
  const latest = db.all<{ game_id: number; duration_sec: number | null }>(sql`
    SELECT p.game_id, p.duration_sec FROM ${playSessions} p
    WHERE p.ended_at IS NOT NULL AND p.started_at = (
      SELECT max(q.started_at) FROM ${playSessions} q
      WHERE q.game_id = p.game_id AND q.ended_at IS NOT NULL
    )`)
  for (const row of latest) {
    const entry = stats.get(row.game_id)
    if (entry) entry.lastSessionSec = row.duration_sec
  }
  return stats
}

function groupBy<K, V>(rows: { key: K; value: V }[]): Map<K, V[]> {
  const map = new Map<K, V[]>()
  for (const { key, value } of rows) {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  return map
}

function tagsByGame(db: ShelfDatabase): Map<number, string[]> {
  const rows = db
    .select({ key: gameTags.gameId, value: tags.name })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .orderBy(tags.name)
    .all()
  return groupBy(rows)
}

function collectionsByGame(db: ShelfDatabase): Map<number, number[]> {
  const rows = db
    .select({ key: collectionGames.gameId, value: collectionGames.collectionId })
    .from(collectionGames)
    .all()
  return groupBy(rows)
}

export function toGame(
  row: GameRow,
  stats: SessionStats = NO_STATS,
  gameTagNames: string[] = [],
  collectionIds: number[] = []
): Game {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceId: row.sourceId,
    ownership: row.ownership,
    installState: row.installState,
    installPath: row.installPath,
    executablePath: row.executablePath,
    launchArgs: row.launchArgs,
    coverUrl: mediaUrl(row.coverPath),
    heroUrl: mediaUrl(row.heroPath),
    logoUrl: mediaUrl(row.logoPath),
    screenshotUrls: (row.screenshots ?? []).map((name) => mediaUrl(name)!),
    description: row.description,
    releaseDate: row.releaseDate,
    developer: row.developer,
    genres: row.genres ?? [],
    igdbId: row.igdbId,
    favorite: row.favorite,
    hidden: row.hidden,
    addedAt: row.addedAt.getTime(),
    lastSyncedAt: row.lastSyncedAt?.getTime() ?? null,
    ...stats,
    playtimeSec: (row.externalPlaytimeMin ?? 0) * 60 + stats.playtimeSec,
    localPlaytimeSec: stats.playtimeSec,
    externalPlaytimeMin: row.externalPlaytimeMin,
    tags: gameTagNames,
    collectionIds,
    savePath: row.savePath,
    useRunner: row.useRunner,
    canInstall: row.installState !== 'installed' && installUri(row) !== null,
    canUninstall: row.installState === 'installed' && uninstallUri(row) !== null
  }
}

export function listGames(db: ShelfDatabase): Game[] {
  const rows = db
    .select()
    .from(games)
    .orderBy(sql`${games.title} COLLATE NOCASE`)
    .all()
  const stats = sessionStats(db)
  const gameTagNames = tagsByGame(db)
  const memberships = collectionsByGame(db)
  return rows.map((row) =>
    toGame(row, stats.get(row.id), gameTagNames.get(row.id), memberships.get(row.id))
  )
}

export function getGameRow(db: ShelfDatabase, id: number): GameRow {
  const row = db.select().from(games).where(eq(games.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Ce jeu n’existe plus.')
  return row
}

export function getGame(db: ShelfDatabase, id: number): Game {
  const row = getGameRow(db, id)
  const gameTagNames = db
    .select({ name: tags.name })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .where(eq(gameTags.gameId, id))
    .orderBy(tags.name)
    .all()
    .map((t) => t.name)
  const collectionIds = db
    .select({ id: collectionGames.collectionId })
    .from(collectionGames)
    .where(eq(collectionGames.gameId, id))
    .all()
    .map((c) => c.id)
  return toGame(row, sessionStats(db, [id]).get(id), gameTagNames, collectionIds)
}

export function getGameDetail(db: ShelfDatabase, id: number, sessionLimit = 20): GameDetail {
  const game = getGame(db, id)
  const sessions: PlaySession[] = db
    .select()
    .from(playSessions)
    .where(and(eq(playSessions.gameId, id), isNotNull(playSessions.endedAt)))
    .orderBy(desc(playSessions.startedAt))
    .limit(sessionLimit)
    .all()
    .map((s) => ({
      id: s.id,
      gameId: s.gameId,
      startedAt: s.startedAt.getTime(),
      endedAt: s.endedAt?.getTime() ?? null,
      durationSec: s.durationSec
    }))
  const dlcs = db
    .select({ id: gameDlcs.id, title: gameDlcs.title })
    .from(gameDlcs)
    .where(eq(gameDlcs.gameId, id))
    .orderBy(asc(sql`${gameDlcs.title} COLLATE NOCASE`))
    .all()
  return { game, sessions, dlcs }
}

export function createManualGame(db: ShelfDatabase, input: Required<GameInput>): Game {
  const row = db
    .insert(games)
    .values({
      title: input.title,
      source: 'manual',
      sourceId: randomUUID(),
      ownership: 'manual',
      installState: 'installed',
      executablePath: input.executablePath,
      launchArgs: input.launchArgs,
      installPath: input.installPath ?? dirname(input.executablePath)
    })
    .returning()
    .get()
  return toGame(row)
}

export function updateGame(db: ShelfDatabase, id: number, patch: GamePatch): Game {
  getGameRow(db, id)
  if (Object.keys(patch).length > 0) {
    db.update(games).set(patch).where(eq(games.id, id)).run()
  }
  return getGame(db, id)
}

export function deleteGame(db: ShelfDatabase, id: number): void {
  getGameRow(db, id)
  db.delete(games).where(eq(games.id, id)).run()
}

// Play sessions. A session row is opened when the process starts so a crash of Shelf
// leaves a trace; unfinished rows are discarded at the next start.

export function openSession(db: ShelfDatabase, gameId: number, startedAt: Date): number {
  return db.insert(playSessions).values({ gameId, startedAt }).returning().get().id
}

export function closeSession(db: ShelfDatabase, sessionId: number, endedAt: Date): void {
  const session = db.select().from(playSessions).where(eq(playSessions.id, sessionId)).get()
  if (!session) return
  const durationSec = Math.max(
    0,
    Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
  )
  db.update(playSessions).set({ endedAt, durationSec }).where(eq(playSessions.id, sessionId)).run()
}

export function discardUnfinishedSessions(db: ShelfDatabase): number {
  return db.delete(playSessions).where(isNull(playSessions.endedAt)).run().changes
}
