import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { accounts, games, playSessions } from '../../src/main/db/schema'

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
      'game_dlcs',
      'game_tags',
      'games',
      'play_sessions',
      'settings',
      'tags',
      'wishlist'
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

  it('drops accounts of the removed Legendary provider, keeps their games', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shelf-db-'))
    const file = join(dir, 'shelf.db')
    try {
      const before = openDatabase(file, migrationsFolder)
      const account = { source: 'epic' as const, displayName: 'Epic', externalUserId: 'u' }
      before.sqlite
        .prepare(
          "INSERT INTO accounts (id, kind, source, display_name, external_user_id) VALUES ('epic-legendary:fan', 'epic-legendary', 'epic', 'fan', 'fan')"
        )
        .run()
      before.db
        .insert(accounts)
        .values({ id: 'epic-launcher:local', kind: 'epic-launcher', ...account })
        .run()
      before.db
        .insert(games)
        .values({ title: 'Celeste', source: 'epic', sourceId: 'Salt', ownership: 'owned' })
        .run()
      // Back to the database as it was before this migration.
      before.sqlite
        .prepare(
          'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)'
        )
        .run()
      before.close()

      const after = openDatabase(file, migrationsFolder)
      try {
        expect(after.db.select({ id: accounts.id }).from(accounts).all()).toEqual([
          { id: 'epic-launcher:local' }
        ])
        expect(after.db.select().from(games).all()).toHaveLength(1)
      } finally {
        after.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
