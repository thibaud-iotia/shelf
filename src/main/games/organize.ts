import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { AppError } from '../../shared/errors'
import type { Collection, SmartRules, Tag } from '../../shared/models'
import { GAME_SOURCES } from '../../shared/domain'
import { fold } from '../../shared/library'
import type { ShelfDatabase } from '../db/client'
import { collectionGames, collections, gameTags, games, tags } from '../db/schema'
import { getGameRow } from './repository'

// Tags (many-to-many) and collections (manual or smart).

const MAX_NAME = 60

function name(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('VALIDATION', `${label} : nom obligatoire.`)
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length > MAX_NAME)
    throw new AppError('VALIDATION', `${label} : ${MAX_NAME} caractères maximum.`)
  return trimmed
}

export function listTags(db: ShelfDatabase): Tag[] {
  return db
    .select({ id: tags.id, name: tags.name, count: sql<number>`count(${gameTags.gameId})` })
    .from(tags)
    .leftJoin(gameTags, eq(gameTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(sql`${tags.name} COLLATE NOCASE`)
    .all()
}

/** Replaces the tags of a game; unknown names are created, orphan tags removed. */
export function setGameTags(db: ShelfDatabase, gameId: number, names: unknown): void {
  getGameRow(db, gameId)
  if (!Array.isArray(names)) throw new AppError('VALIDATION', 'Tags invalides.')
  const wanted = [...new Set(names.map((n) => name(n, 'Tag').toLowerCase()))]

  db.transaction((tx) => {
    const ids = wanted.map((tagName) => {
      const existing = tx.select().from(tags).where(eq(tags.name, tagName)).get()
      return existing?.id ?? tx.insert(tags).values({ name: tagName }).returning().get().id
    })
    tx.delete(gameTags)
      .where(
        and(eq(gameTags.gameId, gameId), ids.length ? notInArray(gameTags.tagId, ids) : undefined)
      )
      .run()
    for (const tagId of ids) {
      tx.insert(gameTags).values({ gameId, tagId }).onConflictDoNothing().run()
    }
    tx.delete(tags)
      .where(sql`${tags.id} NOT IN (SELECT ${gameTags.tagId} FROM ${gameTags})`)
      .run()
  })
}

export function deleteTag(db: ShelfDatabase, id: number): void {
  db.delete(tags).where(eq(tags.id, id)).run()
}

// Collections

export function validateRules(value: unknown): SmartRules | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') throw new AppError('VALIDATION', 'Règles invalides.')
  const raw = value as Record<string, unknown>
  const rules: SmartRules = {}
  const strings = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
  if (raw.sources !== undefined) {
    const list = strings(raw.sources)
    if (!list || list.some((s) => !(GAME_SOURCES as readonly string[]).includes(s))) {
      throw new AppError('VALIDATION', 'Règle « source » invalide.')
    }
    rules.sources = list as SmartRules['sources']
  }
  for (const key of ['tags', 'genres'] as const) {
    if (raw[key] === undefined) continue
    const list = strings(raw[key])
    if (!list) throw new AppError('VALIDATION', `Règle « ${key} » invalide.`)
    rules[key] = list
  }
  for (const key of ['installed', 'favorite', 'neverPlayed'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean')
      throw new AppError('VALIDATION', `Règle « ${key} » invalide.`)
    rules[key] = raw[key] as boolean
  }
  if (raw.minPlaytimeHours !== undefined) {
    if (typeof raw.minPlaytimeHours !== 'number' || raw.minPlaytimeHours < 0) {
      throw new AppError('VALIDATION', 'Règle « temps de jeu » invalide.')
    }
    rules.minPlaytimeHours = raw.minPlaytimeHours
  }
  return rules
}

export function listCollections(db: ShelfDatabase): Collection[] {
  const rows = db
    .select()
    .from(collections)
    .orderBy(sql`${collections.name} COLLATE NOCASE`)
    .all()
  const members = db
    .select()
    .from(collectionGames)
    .orderBy(asc(collectionGames.position), asc(collectionGames.gameId))
    .all()
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    rules: c.rules ?? null,
    gameIds: c.rules ? [] : members.filter((m) => m.collectionId === c.id).map((m) => m.gameId)
  }))
}

function getCollection(db: ShelfDatabase, id: number): Collection {
  const found = listCollections(db).find((c) => c.id === id)
  if (!found) throw new AppError('NOT_FOUND', 'Cette collection n’existe plus.')
  return found
}

function uniqueName(db: ShelfDatabase, value: string, exceptId?: number): void {
  // SQLite's NOCASE only folds ASCII: compare accent- and case-insensitively here.
  const clash = db
    .select()
    .from(collections)
    .all()
    .find((c) => fold(c.name) === fold(value))
  if (clash && clash.id !== exceptId) {
    throw new AppError('VALIDATION', `La collection « ${value} » existe déjà.`)
  }
}

export function createCollection(
  db: ShelfDatabase,
  rawName: unknown,
  rawRules?: unknown
): Collection {
  const value = name(rawName, 'Collection')
  uniqueName(db, value)
  const row = db
    .insert(collections)
    .values({ name: value, rules: validateRules(rawRules) })
    .returning()
    .get()
  return getCollection(db, row.id)
}

export function updateCollection(
  db: ShelfDatabase,
  id: number,
  patch: { name?: unknown; rules?: unknown }
): Collection {
  getCollection(db, id)
  const set: { name?: string; rules?: SmartRules | null } = {}
  if (patch && 'name' in patch) {
    set.name = name(patch.name, 'Collection')
    uniqueName(db, set.name, id)
  }
  if (patch && 'rules' in patch) set.rules = validateRules(patch.rules)
  if (Object.keys(set).length) db.update(collections).set(set).where(eq(collections.id, id)).run()
  return getCollection(db, id)
}

export function deleteCollection(db: ShelfDatabase, id: number): void {
  getCollection(db, id)
  db.delete(collections).where(eq(collections.id, id)).run()
}

export function addToCollection(db: ShelfDatabase, id: number, gameIds: number[]): Collection {
  const collection = getCollection(db, id)
  if (collection.rules) {
    throw new AppError('VALIDATION', 'Une collection intelligente se remplit avec ses règles.')
  }
  const valid = gameIds.length
    ? db.select({ id: games.id }).from(games).where(inArray(games.id, gameIds)).all()
    : []
  const { max } = db
    .select({ max: sql<number>`coalesce(max(${collectionGames.position}), -1)` })
    .from(collectionGames)
    .where(eq(collectionGames.collectionId, id))
    .get()!
  let position = max
  const existing = new Set(valid.map((g) => g.id))
  // Keep the requested order (drag and drop, multi-select).
  for (const gameId of [...new Set(gameIds)].filter((id) => existing.has(id))) {
    db.insert(collectionGames)
      .values({ collectionId: id, gameId, position: ++position })
      .onConflictDoNothing()
      .run()
  }
  return getCollection(db, id)
}

export function removeFromCollection(db: ShelfDatabase, id: number, gameId: number): Collection {
  db.delete(collectionGames)
    .where(and(eq(collectionGames.collectionId, id), eq(collectionGames.gameId, gameId)))
    .run()
  return getCollection(db, id)
}
