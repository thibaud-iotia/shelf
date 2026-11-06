import { and, desc, eq, inArray, not } from 'drizzle-orm'
import { AppError } from '../../shared/errors'
import type { StoreGameRef } from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { games, wishlist } from '../db/schema'
import { normalizeTitle } from '../games/titles'

export type WishRow = typeof wishlist.$inferSelect

export function listWishlist(db: ShelfDatabase): WishRow[] {
  return db.select().from(wishlist).orderBy(desc(wishlist.addedAt), desc(wishlist.id)).all()
}

export interface SteamWish {
  appId: string
  title: string
  imageUrl: string | null
  addedAt: number | null
}

/**
 * Mirrors the Steam wishlist: listed games are flagged `fromSteam`, the others lose the flag,
 * and rows nobody keeps any more (not on Steam, not added in Shelf) are removed.
 */
export function syncSteamWishlist(db: ShelfDatabase, items: SteamWish[]): void {
  db.transaction((tx) => {
    for (const item of items) {
      tx.insert(wishlist)
        .values({
          title: item.title,
          steamAppId: item.appId,
          imageUrl: item.imageUrl,
          fromSteam: true,
          ...(item.addedAt ? { addedAt: new Date(item.addedAt) } : {})
        })
        .onConflictDoUpdate({
          target: wishlist.steamAppId,
          set: {
            fromSteam: true,
            title: item.title,
            ...(item.imageUrl ? { imageUrl: item.imageUrl } : {})
          }
        })
        .run()
    }
    const listed = items.map((i) => i.appId)
    const stale = tx
      .select({ id: wishlist.id, steamAppId: wishlist.steamAppId })
      .from(wishlist)
      .where(eq(wishlist.fromSteam, true))
      .all()
      .filter((row) => !row.steamAppId || !listed.includes(row.steamAppId))
      .map((row) => row.id)
    if (stale.length) {
      tx.update(wishlist).set({ fromSteam: false }).where(inArray(wishlist.id, stale)).run()
    }
    tx.delete(wishlist)
      .where(and(eq(wishlist.fromSteam, false), eq(wishlist.byUser, false)))
      .run()
  })
}

/** Adds a game to the Shelf list (or marks a Steam wishlist entry as kept by the user). */
export function addWish(db: ShelfDatabase, ref: StoreGameRef): WishRow {
  const existing = ref.steamAppId
    ? db.select().from(wishlist).where(eq(wishlist.steamAppId, ref.steamAppId)).get()
    : ref.cheapsharkId
      ? db.select().from(wishlist).where(eq(wishlist.cheapsharkId, ref.cheapsharkId)).get()
      : undefined
  if (!ref.steamAppId && !ref.cheapsharkId) {
    throw new AppError('VALIDATION', 'Ce jeu n’a pas de référence de boutique.')
  }
  if (existing) {
    return db
      .update(wishlist)
      .set({
        byUser: true,
        steamAppId: existing.steamAppId ?? ref.steamAppId,
        cheapsharkId: existing.cheapsharkId ?? ref.cheapsharkId,
        imageUrl: existing.imageUrl ?? ref.imageUrl ?? null
      })
      .where(eq(wishlist.id, existing.id))
      .returning()
      .get()
  }
  // The other id may already belong to another row (same game seen differently): keep one.
  const cheapsharkTaken =
    ref.cheapsharkId &&
    db.select().from(wishlist).where(eq(wishlist.cheapsharkId, ref.cheapsharkId)).get()
  return db
    .insert(wishlist)
    .values({
      title: ref.title,
      steamAppId: ref.steamAppId,
      cheapsharkId: cheapsharkTaken ? null : ref.cheapsharkId,
      imageUrl: ref.imageUrl ?? null,
      byUser: true
    })
    .returning()
    .get()
}

export const STEAM_WISH_REMOVE =
  'Ce jeu vient de votre liste de souhaits Steam : retirez-le depuis Steam.'

export function removeWish(db: ShelfDatabase, id: number): void {
  const row = db.select().from(wishlist).where(eq(wishlist.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Ce jeu n’est plus dans la liste de souhaits.')
  if (row.fromSteam) {
    if (!row.byUser) throw new AppError('VALIDATION', STEAM_WISH_REMOVE)
    db.update(wishlist).set({ byUser: false }).where(eq(wishlist.id, id)).run()
    return
  }
  db.delete(wishlist).where(eq(wishlist.id, id)).run()
}

/** After a purchase: the Shelf entry goes; a Steam entry leaves at the next wishlist sync. */
export function dropBought(db: ShelfDatabase, ref: Pick<StoreGameRef, 'steamAppId' | 'title'>) {
  const wanted = normalizeTitle(ref.title)
  const ids = listWishlist(db)
    .filter(
      (row) =>
        (ref.steamAppId && row.steamAppId === ref.steamAppId) ||
        (wanted && normalizeTitle(row.title) === wanted)
    )
    .map((row) => row.id)
  if (!ids.length) return
  db.delete(wishlist)
    .where(and(inArray(wishlist.id, ids), not(wishlist.fromSteam)))
    .run()
  db.update(wishlist).set({ byUser: false }).where(inArray(wishlist.id, ids)).run()
}

/** Library lookup: by Steam appid (own or matched), else by normalized title. */
export interface OwnedIndex {
  find: (ref: Pick<StoreGameRef, 'steamAppId' | 'title'>) => number | null
}

export function ownedIndex(db: ShelfDatabase): OwnedIndex {
  const bySteam = new Map<string, number>()
  const byTitle = new Map<string, number>()
  const rows = db
    .select({
      id: games.id,
      title: games.title,
      source: games.source,
      sourceId: games.sourceId,
      steamAppId: games.steamAppId
    })
    .from(games)
    .all()
  for (const row of rows) {
    if (row.source === 'steam') bySteam.set(row.sourceId, row.id)
    else if (row.steamAppId && !bySteam.has(row.steamAppId)) bySteam.set(row.steamAppId, row.id)
    const key = normalizeTitle(row.title)
    if (key && !byTitle.has(key)) byTitle.set(key, row.id)
  }
  return {
    find: (ref) =>
      (ref.steamAppId ? bySteam.get(ref.steamAppId) : undefined) ??
      byTitle.get(normalizeTitle(ref.title)) ??
      null
  }
}
