import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type ShelfDatabase = BetterSQLite3Database<typeof schema>

export interface DatabaseHandle {
  db: ShelfDatabase
  sqlite: Database.Database
  appliedMigrations: number
  close(): void
}

/**
 * Opens (or creates) the SQLite file and applies pending migrations.
 * Pass ':memory:' for tests.
 */
export function openDatabase(file: string, migrationsFolder: string): DatabaseHandle {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })

  const { count } = sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as {
    count: number
  }

  return { db, sqlite, appliedMigrations: count, close: () => sqlite.close() }
}
