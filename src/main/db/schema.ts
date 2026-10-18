import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { GAME_SOURCES, INSTALL_STATES, OWNERSHIPS } from '../../shared/domain'
import type { AccountKind, SmartRules } from '../../shared/models'

const now = sql`(unixepoch() * 1000)`

export const games = sqliteTable(
  'games',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    source: text('source', { enum: GAME_SOURCES }).notNull(),
    // Launcher-side id (Steam appid, Epic app name…). Manual games get a generated UUID.
    sourceId: text('source_id').notNull(),
    ownership: text('ownership', { enum: OWNERSHIPS }).notNull().default('manual'),
    installState: text('install_state', { enum: INSTALL_STATES }).notNull().default('unknown'),
    installPath: text('install_path'),
    executablePath: text('executable_path'),
    launchArgs: text('launch_args'),
    coverPath: text('cover_path'),
    heroPath: text('hero_path'),
    logoPath: text('logo_path'),
    // JSON array of file names in the covers cache.
    screenshots: text('screenshots', { mode: 'json' }).$type<string[]>(),
    description: text('description'),
    releaseDate: text('release_date'),
    developer: text('developer'),
    genres: text('genres', { mode: 'json' }).$type<string[]>(),
    igdbId: integer('igdb_id'),
    externalPlaytimeMin: integer('external_playtime_min'),
    savePath: text('save_path'),
    useRunner: integer('use_runner', { mode: 'boolean' }).notNull().default(false),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(now),
    lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' })
  },
  (t) => [uniqueIndex('games_source_source_id_unique').on(t.source, t.sourceId)]
)

// Add-ons (DLC, cosmetic packs, expansions) owned on a launcher account: shown on their base
// game's page, never listed as games. Same (source, sourceId) identity as games.
export const gameDlcs = sqliteTable(
  'game_dlcs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    source: text('source', { enum: GAME_SOURCES }).notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull()
  },
  (t) => [
    uniqueIndex('game_dlcs_source_source_id_unique').on(t.source, t.sourceId),
    index('game_dlcs_game_id_idx').on(t.gameId)
  ]
)

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<AccountKind>().notNull().default('steam'),
    source: text('source', { enum: GAME_SOURCES }).notNull(),
    displayName: text('display_name').notNull(),
    externalUserId: text('external_user_id').notNull(),
    // Key of the secret stored through safeStorage — never the secret itself.
    credentialsRef: text('credentials_ref'),
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error')
  },
  (t) => [uniqueIndex('accounts_source_external_unique').on(t.source, t.externalUserId)]
)

export const playSessions = sqliteTable(
  'play_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    durationSec: integer('duration_sec')
  },
  (t) => [index('play_sessions_game_id_idx').on(t.gameId)]
)

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique()
})

export const gameTags = sqliteTable(
  'game_tags',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.gameId, t.tagId] })]
)

export const collections = sqliteTable('collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  // Smart collection criteria (JSON SmartRules); null = manual collection.
  rules: text('rules', { mode: 'json' }).$type<SmartRules>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now)
})

export const collectionGames = sqliteTable(
  'collection_games',
  {
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.gameId] })]
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  // JSON-encoded value.
  value: text('value').notNull()
})
