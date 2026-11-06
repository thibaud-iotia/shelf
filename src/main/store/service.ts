import type { GameSourceId } from '../../shared/domain'
import { AppError } from '../../shared/errors'
import type {
  BestDeal,
  LocalPrice,
  PurchaseInput,
  PurchaseResult,
  StoreGame,
  StoreGameDetail,
  StoreGameRef,
  StoreOffer,
  WishlistView
} from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { normalizeTitle } from '../games/titles'
import { parseRemoteImageUrl, remoteImageUrl } from '../media/remote'
import type { FetchLike } from '../net/http'
import {
  bestBySteamApp,
  bestOfGame,
  CheapSharkClient,
  dealToBest,
  parseStores,
  steamAppIdOf,
  storeName,
  STORE_IDS,
  uniqueDeals,
  type CsGame,
  type StoreNames
} from './cheapshark'
import { GogCatalogClient, matchGogProduct, type GogProduct } from './gog'
import { purchaseTarget, type PurchaseEnv } from './purchase'
import {
  parseStoreItems,
  parseWishlist,
  steamHeaderUrl,
  SteamStoreApi,
  type SteamItem
} from './steam'
import type { PendingPurchase } from './watcher'
import {
  addWish,
  listWishlist,
  ownedIndex,
  removeWish,
  syncSteamWishlist,
  type OwnedIndex
} from './wishlist'

export interface StoreDeps {
  db: ShelfDatabase
  /** SteamID of the connected Steam account (its wishlist is imported), if any. */
  steamId: () => string | null
  /** Whether a launcher is installed (its store URI can be opened). */
  launcherAvailable: (source: GameSourceId) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  /** Follows the purchase until the game shows up in the library. */
  watchPurchase: (purchase: PendingPurchase) => void
  userAgent: string
  platform?: NodeJS.Platform
  fetch?: FetchLike
  now?: () => number
  ttlMs?: number
  /** The Steam wishlist is re-imported when older than this. */
  wishlistMaxAgeMs?: number
}

export const NO_STORE_REF = 'Ce jeu n’a pas de référence de boutique.'
export const WISHLIST_EMPTY_OR_PRIVATE =
  'Liste de souhaits Steam vide ou privée : rendez-la publique dans la confidentialité du profil Steam pour l’importer.'

const STORE_SOURCE: Record<string, GameSourceId> = {
  [STORE_IDS.steam]: 'steam',
  [STORE_IDS.gog]: 'gog',
  [STORE_IDS.epic]: 'epic'
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface BaseGame {
  title: string
  steamAppId: string | null
  cheapsharkId: string | null
  /** Raw https URL. */
  imageUrl: string | null
  best?: BestDeal | null
  wishlist?: StoreGame['wishlist']
  steamRating?: StoreGame['steamRating']
}

/**
 * Store views: wishlist (Steam + Shelf), current deals, search and the purchase sheet of a
 * game, with CheapShark prices (US dollars) completed by Steam and GOG prices in euros.
 * Purchases open the launcher's store page (or the browser) and are then followed by the
 * PurchaseWatcher. Responses are kept in memory for `ttlMs` (failures are not kept).
 */
export class StoreService {
  private readonly cheapshark: CheapSharkClient
  private readonly steam: SteamStoreApi
  private readonly gog: GogCatalogClient
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>()
  private readonly now: () => number
  private readonly ttlMs: number
  private wishlistSync: { at: number | null; error: string | null } = { at: null, error: null }

  constructor(private readonly deps: StoreDeps) {
    this.cheapshark = new CheapSharkClient(deps.userAgent, deps.fetch)
    this.steam = new SteamStoreApi(deps.fetch)
    this.gog = new GogCatalogClient(deps.fetch)
    this.now = deps.now ?? Date.now
    this.ttlMs = deps.ttlMs ?? 10 * 60_000
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.value as Promise<T>
    const value = load()
    this.cache.set(key, { expiresAt: this.now() + this.ttlMs, value })
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key)
    })
    return value
  }

  private storeNames(): Promise<StoreNames> {
    return this.cached('stores', () => this.cheapshark.stores())
      .then(parseStores)
      .catch(() => parseStores([]))
  }

  /** Steam names, images and prices in euros, 50 appids per call. */
  private async steamItems(appIds: string[]): Promise<Map<string, SteamItem>> {
    const all = new Map<string, SteamItem>()
    for (const part of chunks([...new Set(appIds)].sort(), 50)) {
      const items = await this.cached(`steam-items:${part.join(',')}`, () =>
        this.steam.items(part)
      ).then(parseStoreItems)
      items.forEach((item, id) => all.set(id, item))
    }
    return all
  }

  /** Cheapest deal of each Steam appid (10 per call: a game has a deal per store). */
  private async bestForSteamApps(appIds: string[], names: StoreNames) {
    const all = new Map<string, BestDeal>()
    for (const part of chunks([...new Set(appIds)].sort(), 10)) {
      const deals = await this.cached(`cs-steam:${part.join(',')}`, () =>
        this.cheapshark.dealsForSteamApps(part)
      )
      bestBySteamApp(deals, names).forEach((deal, id) => all.set(id, deal))
    }
    return all
  }

  private async csGames(ids: string[]): Promise<Map<string, CsGame>> {
    const all = new Map<string, CsGame>()
    for (const part of chunks([...new Set(ids)].sort(), 25)) {
      const games = await this.cached(`cs-games:${part.join(',')}`, () =>
        this.cheapshark.games(part)
      )
      for (const [id, game] of Object.entries(games ?? {})) if (game?.info) all.set(id, game)
    }
    return all
  }

  /**
   * Adds prices, ownership and wishlist state to games. Price failures leave the prices
   * empty and are reported once (`pricesError`), the games are still listed.
   */
  private async decorate(
    base: BaseGame[],
    options: { owned?: OwnedIndex; withBest?: boolean } = {}
  ): Promise<{ games: StoreGame[]; pricesError: string | null }> {
    const owned = options.owned ?? ownedIndex(this.deps.db)
    const wishes = listWishlist(this.deps.db)
    const errors: string[] = []
    const quiet = <T>(promise: Promise<T>, fallback: T) =>
      promise.catch((error: unknown) => {
        errors.push(errorMessage(error))
        return fallback
      })

    const appIds = base.flatMap((g) => (g.steamAppId ? [g.steamAppId] : []))
    const needBest = options.withBest !== false
    const bestAppIds = base.flatMap((g) =>
      g.steamAppId && g.best === undefined ? [g.steamAppId] : []
    )
    const names = needBest ? await this.storeNames() : new Map<string, string>()
    const [steamItems, steamBest, csGames] = await Promise.all([
      appIds.length ? quiet(this.steamItems(appIds), new Map<string, SteamItem>()) : new Map(),
      needBest && bestAppIds.length
        ? quiet(this.bestForSteamApps(bestAppIds, names), new Map<string, BestDeal>())
        : new Map<string, BestDeal>(),
      needBest
        ? quiet(
            this.csGames(
              base.flatMap((g) =>
                !g.steamAppId && g.best === undefined && g.cheapsharkId ? [g.cheapsharkId] : []
              )
            ),
            new Map<string, CsGame>()
          )
        : new Map<string, CsGame>()
    ])

    const games = base.map((g): StoreGame => {
      const item = g.steamAppId ? steamItems.get(g.steamAppId) : undefined
      const wish =
        g.wishlist !== undefined
          ? g.wishlist
          : (wishes.find(
              (w) =>
                (g.steamAppId && w.steamAppId === g.steamAppId) ||
                (g.cheapsharkId && w.cheapsharkId === g.cheapsharkId)
            ) ?? null)
      const csGame = g.cheapsharkId ? csGames.get(g.cheapsharkId) : undefined
      const best =
        g.best !== undefined
          ? g.best
          : ((g.steamAppId ? steamBest.get(g.steamAppId) : undefined) ??
            (csGame ? bestOfGame(csGame, names) : null))
      return {
        key: g.steamAppId ? `steam:${g.steamAppId}` : `cs:${g.cheapsharkId}`,
        title: g.title || item?.name || '',
        steamAppId: g.steamAppId,
        cheapsharkId: g.cheapsharkId,
        imageUrl: remoteImageUrl(item?.imageUrl ?? g.imageUrl),
        best,
        steamPrice: item?.price ?? null,
        ownedGameId: owned.find(g),
        wishlist: wish ? { id: wish.id, fromSteam: wish.fromSteam, byUser: wish.byUser } : null,
        steamRating: g.steamRating ?? null
      }
    })
    return { games, pricesError: errors[0] ?? null }
  }

  // --- Wishlist ---

  /** Re-imports the Steam wishlist of the connected account (no account: nothing to do). */
  async syncSteamWishlist(): Promise<void> {
    const steamId = this.deps.steamId()
    if (!steamId) {
      this.wishlistSync = { at: null, error: null }
      return
    }
    try {
      const entries = parseWishlist(await this.steam.wishlist(steamId))
      const items = entries.length ? await this.steamItems(entries.map((e) => e.appId)) : new Map()
      syncSteamWishlist(
        this.deps.db,
        entries.map((e) => {
          const item = items.get(e.appId)
          return {
            appId: e.appId,
            title: item?.name || `App ${e.appId}`,
            imageUrl: item?.imageUrl ?? steamHeaderUrl(e.appId),
            addedAt: e.addedAt
          }
        })
      )
      this.wishlistSync = {
        at: this.now(),
        error: entries.length ? null : WISHLIST_EMPTY_OR_PRIVATE
      }
    } catch (error) {
      this.wishlistSync = { at: this.wishlistSync.at, error: errorMessage(error) }
    }
  }

  async wishlist(options: { forceSync?: boolean } = {}): Promise<WishlistView> {
    const maxAge = this.deps.wishlistMaxAgeMs ?? 3600_000
    const { at } = this.wishlistSync
    if (options.forceSync || at === null || this.now() - at > maxAge) {
      await this.syncSteamWishlist()
    }
    const rows = listWishlist(this.deps.db)
    const { games, pricesError } = await this.decorate(
      rows.map((row) => ({
        title: row.title,
        steamAppId: row.steamAppId,
        cheapsharkId: row.cheapsharkId,
        imageUrl: row.imageUrl,
        wishlist: { id: row.id, fromSteam: row.fromSteam, byUser: row.byUser }
      }))
    )
    return {
      items: games,
      steam: {
        connected: this.deps.steamId() !== null,
        syncedAt: this.wishlistSync.at,
        error: this.wishlistSync.error
      },
      pricesError
    }
  }

  addWish(ref: StoreGameRef): void {
    addWish(this.deps.db, {
      ...ref,
      // The renderer only sees proxied image URLs: keep the original.
      imageUrl: ref.imageUrl ? (parseRemoteImageUrl(ref.imageUrl) ?? null) : null
    })
  }

  removeWish(id: number): void {
    removeWish(this.deps.db, id)
  }

  // --- Deals & search ---

  async deals(): Promise<StoreGame[]> {
    const names = await this.storeNames()
    const deals = uniqueDeals(await this.cached('deals', () => this.cheapshark.deals(60)))
    const { games } = await this.decorate(
      deals.map((deal) => {
        const steamAppId = steamAppIdOf(deal.steamAppID)
        const percent = Number(deal.steamRatingPercent)
        return {
          title: deal.title,
          steamAppId,
          cheapsharkId: deal.gameID,
          imageUrl: steamAppId ? steamHeaderUrl(steamAppId) : (deal.thumb ?? null),
          best: dealToBest(deal, names),
          steamRating:
            deal.steamRatingText && percent > 0 ? { text: deal.steamRatingText, percent } : null
        }
      })
    )
    return games
  }

  async search(query: string): Promise<StoreGame[]> {
    const title = query.trim()
    if (!title) return []
    const results = await this.cached(`search:${title.toLowerCase()}`, () =>
      this.cheapshark.search(title, 24)
    )
    const names = await this.storeNames()
    const details = await this.csGames(results.map((r) => r.gameID)).catch(
      () => new Map<string, CsGame>()
    )
    const { games } = await this.decorate(
      results.map((r) => {
        const steamAppId = steamAppIdOf(r.steamAppID)
        const detail = details.get(r.gameID)
        return {
          title: r.external,
          steamAppId,
          cheapsharkId: r.gameID,
          imageUrl: steamAppId ? steamHeaderUrl(steamAppId) : (r.thumb ?? null),
          best: detail ? bestOfGame(detail, names) : null
        }
      }),
      { withBest: true }
    )
    return games
  }

  // --- Purchase sheet ---

  private async purchaseEnv(): Promise<PurchaseEnv> {
    const [steam, gogGalaxy] = await Promise.all([
      this.deps.launcherAvailable('steam').catch(() => false),
      this.deps.launcherAvailable('gog').catch(() => false)
    ])
    return { platform: this.deps.platform ?? process.platform, steam, gogGalaxy }
  }

  /** CheapShark id of a game: given, else by Steam appid, else by exact title. */
  private async resolveCheapSharkId(ref: StoreGameRef): Promise<string | null> {
    if (ref.cheapsharkId) return ref.cheapsharkId
    const results = ref.steamAppId
      ? await this.cached(`cs-app:${ref.steamAppId}`, () =>
          this.cheapshark.bySteamApp(ref.steamAppId!)
        )
      : await this.cached(`search:${ref.title.toLowerCase()}`, () =>
          this.cheapshark.search(ref.title, 24)
        )
    const wanted = normalizeTitle(ref.title)
    const hit = ref.steamAppId
      ? results[0]
      : results.find((r) => normalizeTitle(r.external) === wanted)
    return hit?.gameID ?? null
  }

  private gogProduct(title: string): Promise<GogProduct | null> {
    return this.cached(`gog:${title.toLowerCase()}`, () => this.gog.search(title))
      .then((data) => matchGogProduct(data, title))
      .catch(() => null)
  }

  async game(ref: StoreGameRef): Promise<StoreGameDetail> {
    if (!ref.steamAppId && !ref.cheapsharkId && !ref.title.trim()) {
      throw new AppError('VALIDATION', NO_STORE_REF)
    }
    const [names, env, cheapsharkId] = await Promise.all([
      this.storeNames(),
      this.purchaseEnv(),
      this.resolveCheapSharkId(ref).catch(() => null)
    ])
    const csGame = cheapsharkId
      ? await this.cached(`cs-game:${cheapsharkId}`, () => this.cheapshark.game(cheapsharkId))
      : null
    const steamAppId = ref.steamAppId ?? steamAppIdOf(csGame?.info.steamAppID)
    const title = ref.title || csGame?.info.title || ''
    const deals = csGame?.deals ?? []
    const hasGog = deals.some((d) => d.storeID === STORE_IDS.gog)
    const [steamItems, gog] = await Promise.all([
      steamAppId
        ? this.steamItems([steamAppId]).catch(() => new Map<string, SteamItem>())
        : new Map<string, SteamItem>(),
      hasGog ? this.gogProduct(title) : null
    ])
    const steamPrice = steamAppId ? (steamItems.get(steamAppId)?.price ?? null) : null

    const offer = (
      storeId: string,
      deal: { dealID: string; price: string; retailPrice: string; savings: string } | null,
      localPrice: LocalPrice | null
    ): StoreOffer => {
      const gogRef = storeId === STORE_IDS.gog && gog ? { id: gog.id, slug: gog.slug } : null
      const target = purchaseTarget(
        { storeId, dealId: deal?.dealID ?? null, steamAppId, gog: gogRef },
        env
      )
      return {
        storeId,
        storeName: storeName(names, storeId),
        dealId: deal?.dealID ?? null,
        price: deal ? Number(deal.price) : null,
        retailPrice: deal ? Number(deal.retailPrice) : null,
        discountPct: deal ? Math.round(Number(deal.savings) || 0) : (localPrice?.discountPct ?? 0),
        localPrice,
        opensIn: target?.opensIn ?? 'browser',
        gog: gogRef
      }
    }

    const offers = deals.map((deal) =>
      offer(
        deal.storeID,
        deal,
        deal.storeID === STORE_IDS.steam
          ? steamPrice
          : deal.storeID === STORE_IDS.gog
            ? (gog?.price ?? null)
            : null
      )
    )
    // Sold on Steam but unknown to CheapShark (or no deal right now): still offer Steam.
    if (steamAppId && !offers.some((o) => o.storeId === STORE_IDS.steam)) {
      offers.push(offer(STORE_IDS.steam, null, steamPrice))
    }
    offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))

    const [base] = (
      await this.decorate(
        [
          {
            title,
            steamAppId,
            cheapsharkId,
            imageUrl:
              ref.imageUrl && parseRemoteImageUrl(ref.imageUrl)
                ? parseRemoteImageUrl(ref.imageUrl)
                : steamAppId
                  ? steamHeaderUrl(steamAppId)
                  : (csGame?.info.thumb ?? null),
            best: csGame ? bestOfGame(csGame, names) : null
          }
        ],
        { withBest: false }
      )
    ).games
    const lowest = csGame?.cheapestPriceEver
    const hero = steamAppId ? steamItems.get(steamAppId)?.heroUrl : null
    return {
      ...base!,
      heroUrl: remoteImageUrl(hero ?? null),
      offers,
      lowestEver: lowest ? { price: Number(lowest.price), date: lowest.date * 1000 } : null
    }
  }

  async buy(input: PurchaseInput): Promise<PurchaseResult> {
    const target = purchaseTarget(input, await this.purchaseEnv())
    if (!target) throw new AppError('VALIDATION', 'Aucun lien d’achat pour cette offre.')
    await this.deps.openExternal(target.url)
    this.deps.watchPurchase({
      title: input.title,
      steamAppId: input.steamAppId,
      source: STORE_SOURCE[input.storeId] ?? null
    })
    return { opensIn: target.opensIn }
  }
}
