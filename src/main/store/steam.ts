import type { LocalPrice } from '../../shared/models'
import { requestJson, type FetchLike } from '../net/http'
import { steamHeaderUrl } from '../insights/steam-store'

// Steam side of the store: the account's wishlist and store prices in euros.
// GetItems checked live on 2026-11-06 (tests/fixtures/api/steam-store-items.json); the
// wishlist fixture follows the documentation (a private or empty list answers `{}`).

const API = 'https://api.steampowered.com'
const ASSETS = 'https://shared.fastly.steamstatic.com/store_item_assets/'
export { steamHeaderUrl }

export const steamStoreUrl = (appId: string) => `https://store.steampowered.com/app/${appId}/`
export const steamStoreUri = (appId: string) => `steam://store/${appId}`

export interface WishlistResponse {
  response?: { items?: { appid?: number; priority?: number; date_added?: number }[] }
}

export interface StoreItemsResponse {
  response?: {
    store_items?: {
      appid?: number
      success?: number
      name?: string
      is_free?: boolean
      assets?: { asset_url_format?: string; header?: string; library_hero?: string }
      best_purchase_option?: {
        final_price_in_cents?: string
        original_price_in_cents?: string
        formatted_final_price?: string
        formatted_original_price?: string
        discount_pct?: number
      }
    }[]
  }
}

export interface SteamItem {
  appId: string
  name: string
  imageUrl: string
  /** Wide library artwork (3840×1240), shown as the store page's hero. */
  heroUrl: string | null
  price: LocalPrice | null
}

/** Wishlist entries, highest priority first (0 = unranked, last; then most recent). */
export function parseWishlist(data: WishlistResponse): { appId: string; addedAt: number | null }[] {
  const items = (data.response?.items ?? []).filter((item) => item.appid)
  const rank = (p: number | undefined) => (p && p > 0 ? p : Number.MAX_SAFE_INTEGER)
  return items
    .sort(
      (a, b) => rank(a.priority) - rank(b.priority) || (b.date_added ?? 0) - (a.date_added ?? 0)
    )
    .map((item) => ({
      appId: String(item.appid),
      addedAt: item.date_added ? item.date_added * 1000 : null
    }))
}

/** "24,50€" → "24,50 €" (French spacing). */
const spaced = (price: string) => price.replace(/\s*€$/, ' €')

export function parseStoreItems(data: StoreItemsResponse): Map<string, SteamItem> {
  const items = new Map<string, SteamItem>()
  for (const item of data.response?.store_items ?? []) {
    if (!item.appid || item.success !== 1) continue
    const appId = String(item.appid)
    const option = item.best_purchase_option
    let price: LocalPrice | null = null
    if (option?.formatted_final_price) {
      const discountPct = option.discount_pct ?? 0
      price = {
        final: spaced(option.formatted_final_price),
        base:
          discountPct > 0 && option.formatted_original_price
            ? spaced(option.formatted_original_price)
            : null,
        discountPct
      }
    } else if (item.is_free) {
      price = { final: 'Gratuit', base: null, discountPct: 0 }
    }
    const format = item.assets?.asset_url_format
    const asset = (file: string | undefined) =>
      format && file ? ASSETS + format.replace(/\$\{FILENAME\}/, file) : null
    items.set(appId, {
      appId,
      name: item.name ?? '',
      imageUrl: asset(item.assets?.header) ?? steamHeaderUrl(appId),
      heroUrl: asset(item.assets?.library_hero),
      price
    })
  }
  return items
}

export class SteamStoreApi {
  constructor(private readonly fetch?: FetchLike) {}

  wishlist(steamId: string): Promise<WishlistResponse> {
    const url = `${API}/IWishlistService/GetWishlist/v1/?steamid=${encodeURIComponent(steamId)}`
    return requestJson(url, {}, { service: 'Steam', fetch: this.fetch })
  }

  /** Names, header images and prices in euros (50 appids per call). */
  items(appIds: string[]): Promise<StoreItemsResponse> {
    const input = {
      ids: appIds.map((appid) => ({ appid: Number(appid) })),
      context: { language: 'french', country_code: 'FR' },
      data_request: { include_basic_info: true, include_assets: true }
    }
    const query = new URLSearchParams({ input_json: JSON.stringify(input) })
    return requestJson(
      `${API}/IStoreBrowseService/GetItems/v1/?${query}`,
      {},
      { service: 'la boutique Steam', fetch: this.fetch }
    )
  }
}
