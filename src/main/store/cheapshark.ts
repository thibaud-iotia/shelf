import type { BestDeal } from '../../shared/models'
import { requestJson, type FetchLike } from '../net/http'

// CheapShark: free price comparison across PC stores (Steam, GOG, Epic, Humble…), no key.
// Prices are in US dollars, its only currency. Formats checked against the live service on
// 2026-11-06 (fixtures: tests/fixtures/api/cheapshark-*.json).

const API = 'https://www.cheapshark.com/api/1.0'

/** Stores Shelf can open in a launcher; "Promotions" lists their deals. */
export const STORE_IDS = { steam: '1', gog: '7', epic: '25' } as const

/** Used when the store list cannot be fetched. */
const KNOWN_STORES: Record<string, string> = {
  '1': 'Steam',
  '2': 'GamersGate',
  '3': 'GreenManGaming',
  '7': 'GOG',
  '11': 'Humble Store',
  '15': 'Fanatical',
  '25': 'Epic Games Store'
}

/** Purchase page; CheapShark answers 403 to non-browser clients, so it is only opened in the browser. */
export const dealRedirectUrl = (dealId: string) =>
  `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeDealId(dealId))}`

/** Deal ids come URL-encoded in the API responses ("%2FRRv…%3D"). */
function decodeDealId(dealId: string): string {
  try {
    return decodeURIComponent(dealId)
  } catch {
    return dealId
  }
}

// --- Responses ---

export interface CsStore {
  storeID: string
  storeName: string
  isActive: number
  images?: { icon?: string }
}

export interface CsSearchItem {
  gameID: string
  steamAppID: string | null
  cheapest: string
  cheapestDealID: string
  external: string
  thumb?: string
}

export interface CsDeal {
  title: string
  dealID: string
  storeID: string
  gameID: string
  salePrice: string
  normalPrice: string
  savings: string
  steamRatingText?: string | null
  steamRatingPercent?: string
  steamAppID: string | null
  thumb?: string
}

export interface CsGame {
  info: { title: string; steamAppID: string | null; thumb?: string }
  cheapestPriceEver?: { price: string; date: number }
  deals: { storeID: string; dealID: string; price: string; retailPrice: string; savings: string }[]
}

// --- Parsers ---

const num = (value: string | number | null | undefined): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export type StoreNames = Map<string, string>

export function parseStores(data: CsStore[]): StoreNames {
  const names = new Map(Object.entries(KNOWN_STORES))
  for (const store of Array.isArray(data) ? data : []) {
    if (store?.storeID && store.storeName) names.set(store.storeID, store.storeName)
  }
  return names
}

export const storeName = (names: StoreNames, id: string) =>
  names.get(id) ?? KNOWN_STORES[id] ?? `Magasin ${id}`

export const steamAppIdOf = (value: string | null | undefined): string | null =>
  value && /^\d+$/.test(value) && value !== '0' ? value : null

export function dealToBest(deal: CsDeal, names: StoreNames): BestDeal {
  return {
    storeId: deal.storeID,
    storeName: storeName(names, deal.storeID),
    dealId: deal.dealID,
    price: num(deal.salePrice),
    retailPrice: num(deal.normalPrice),
    discountPct: Math.round(num(deal.savings))
  }
}

/** Cheapest deal of each Steam appid (ties: the Steam store first). */
export function bestBySteamApp(deals: CsDeal[], names: StoreNames): Map<string, BestDeal> {
  const best = new Map<string, BestDeal>()
  for (const deal of Array.isArray(deals) ? deals : []) {
    const appId = steamAppIdOf(deal.steamAppID)
    if (!appId) continue
    const candidate = dealToBest(deal, names)
    const current = best.get(appId)
    if (
      !current ||
      candidate.price < current.price ||
      (candidate.price === current.price && candidate.storeId === STORE_IDS.steam)
    ) {
      best.set(appId, candidate)
    }
  }
  return best
}

/** One entry per game (the best-rated deal comes first in CheapShark's order). */
export function uniqueDeals(deals: CsDeal[]): CsDeal[] {
  const seen = new Set<string>()
  return (Array.isArray(deals) ? deals : []).filter((deal) => {
    if (!deal?.gameID || seen.has(deal.gameID)) return false
    seen.add(deal.gameID)
    return true
  })
}

export function bestOfGame(game: CsGame, names: StoreNames): BestDeal | null {
  const deals = [...(game.deals ?? [])].sort((a, b) => num(a.price) - num(b.price))
  const deal = deals[0]
  if (!deal) return null
  return {
    storeId: deal.storeID,
    storeName: storeName(names, deal.storeID),
    dealId: deal.dealID,
    price: num(deal.price),
    retailPrice: num(deal.retailPrice),
    discountPct: Math.round(num(deal.savings))
  }
}

// --- Client ---

export class CheapSharkClient {
  constructor(
    /** CheapShark refuses generic user agents: "Shelf/<version> (+repo URL)". */
    private readonly userAgent: string,
    private readonly fetch?: FetchLike
  ) {}

  private get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = `${API}/${path}?${new URLSearchParams(query)}`
    return requestJson<T>(
      url,
      { headers: { 'User-Agent': this.userAgent } },
      { service: 'CheapShark', fetch: this.fetch }
    )
  }

  stores(): Promise<CsStore[]> {
    return this.get('stores', {})
  }

  search(title: string, limit = 30): Promise<CsSearchItem[]> {
    return this.get('games', { title, limit: String(limit) })
  }

  game(id: string): Promise<CsGame> {
    return this.get('games', { id })
  }

  /** Several games at once (CheapShark caps the list at 25 ids). */
  games(ids: string[]): Promise<Record<string, CsGame>> {
    return this.get('games', { ids: ids.join(',') })
  }

  bySteamApp(appId: string): Promise<CsSearchItem[]> {
    return this.get('games', { steamAppID: appId })
  }

  /** Deals of several Steam appids (every store, one entry per store and game). */
  dealsForSteamApps(appIds: string[]): Promise<CsDeal[]> {
    return this.get('deals', { steamAppID: appIds.join(','), pageSize: '60' })
  }

  /** Best-rated current discounts of the stores Shelf can open. */
  deals(pageSize = 60): Promise<CsDeal[]> {
    return this.get('deals', {
      storeID: Object.values(STORE_IDS).join(','),
      onSale: '1',
      sortBy: 'Deal Rating',
      pageSize: String(pageSize)
    })
  }
}
