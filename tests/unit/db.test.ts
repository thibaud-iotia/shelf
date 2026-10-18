import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games, playSessions } from '../../src/main/db/schema'

const migrationsFolder = resolve(__dirname, '../../drizzle')

describe('database', () => {
  let handle: DatabaseHandle

  beforeEach(() => {
    handle = openDatabase(':memory:', migrationsFolder)
  })

  afterEach(() => handle.close())

  it('applies the initial migration and creates every table', () => {
    expect(handle.appliedMigrations).toBeGreaterThanOrEqual(1)
    const tables = handle.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'"
      )
      .all()
      .map((row) => (row as { name: string }).name)
      .sort()
    expect(tables).toEqual([
      'accounts',
      'collection_games',
      'collections',
      'game_tags',
      'games',
      'play_sessions',
      'settings',
      'tags'
    ])
  })

  it('is idempotent when migrations run twice', () => {
    const second = openDatabase(':memory:', migrationsFolder)
    expect(second.appliedMigrations).toBe(handle.appliedMigrations)
    second.close()
  })

  it('applies defaults on a new game', () => {
    const [row] = handle.db
      .insert(games)
      .values({ title: 'Hades', source: 'steam', sourceId: '1145360' })
      .returning()
      .all()
    expect(row).toMatchObject({
      ownership: 'manual',
      installState: 'unknown',
      favorite: false,
      hidden: false
    })
    expect(row?.addedAt).toBeInstanceOf(Date)
  })

  it('enforces uniqueness of (source, sourceId)', () => {
    handle.db.insert(games).values({ title: 'Hades', source: 'steam', sourceId: '1145360' }).run()
    expect(() =>
      handle.db.insert(games).values({ title: 'Hades', source: 'steam', sourceId: '1145360' }).run()
    ).toThrow(/UNIQUE/)
    // Same sourceId on another source is a different game.
    handle.db.insert(games).values({ title: 'Hades', source: 'epic', sourceId: '1145360' }).run()
  })

  it('cascades play sessions when a game is deleted', () => {
    const [game] = handle.db
      .insert(games)
      .values({ title: 'Celeste', source: 'manual', sourceId: 'abc' })
      .returning()
      .all()
    handle.db
      .insert(playSessions)
      .values({ gameId: game!.id, startedAt: new Date(), durationSec: 60 })
      .run()
    handle.db.delete(games).where(eq(games.id, game!.id)).run()
    expect(handle.db.select().from(playSessions).all()).toHaveLength(0)
  })
})
