import { AppError } from '../../shared/errors'
import { formatEur } from '../../shared/format'
import type { KeyshopOffer } from '../../shared/models'
import { normalizeTitle } from '../games/titles'
import { requestText, type FetchLike } from '../net/http'

// Instant Gaming: key reseller (no public API). Its search page is rendered by Vue from the
// Algolia answer embedded in the HTML (`window.searchResults = {…};`), so one request gives
// every edition with its price in euros, stock and activation platform, as JSON.
// Checked live on 2026-11-08 (tests/fixtures/api/instant-gaming-search*.html). Unofficial:
// a change of the page empties the Instant Gaming block, never the rest of the store page.

const SITE = 'https://www.instant-gaming.com'
export const INSTANT_GAMING = 'Instant Gaming'
/** Store id of Instant Gaming offers in purchases (CheapShark ids are numeric). */
export const INSTANT_GAMING_STORE_ID = 'ig'

export const instantGamingSearchUrl = (title: string) =>
  `${SITE}/fr/rechercher/?${new URLSearchParams({ q: title })}`

export const instantGamingProductUrl = (id: string, slug: string) =>
  `${SITE}/fr/${encodeURIComponent(id)}-acheter-${encodeURIComponent(slug)}/`

export const UNREADABLE_PAGE =
  'Page de recherche d’Instant Gaming illisible (le site a peut-être changé).'
/** HTTP 401/403: no account involved, the site's anti-bot protection refused the request. */
export const BLOCKED = 'Instant Gaming refuse la requête pour le moment : réessayez plus tard.'

/** Platform id of PC in Instant Gaming's `platforms` (Mac 2, Linux 3, Switch 4…). */
const PC = '1'
const COUNTRY = 'FR'

export interface IgHit {
  prod_id?: number | string
  name?: string
  en_name?: string
  small_name?: string
  fullname?: string
  seo_name?: string
  /** Activation platform: "Steam", "Epic Games", "Microsoft Store", "PlayStation Store"… */
  type?: string
  platforms?: string[]
  is_dlc?: number
  is_draft?: number
  preorder?: number
  is_free_to_play?: number
  is_prepaid?: number
  is_subscription?: number
  has_stock?: number
  price_eur?: string
  price?: string
  country_whitelist?: string[] | null
  country_blacklist?: string[] | null
}

export interface IgSearchResults {
  hits?: IgHit[]
}

/** An Instant Gaming edition of the wanted game, before the comparison with official prices. */
export interface IgProduct {
  id: string
  slug: string
  name: string
  platform: string
  amount: number
  inStock: boolean
  preorder: boolean
}

/**
 * The JSON object assigned to `window.searchResults` in the page, read up to its closing
 * brace (strings may contain braces). Throws when the page no longer has it.
 */
export function extractSearchResults(html: string): IgSearchResults {
  const marker = html.indexOf('window.searchResults')
  const start = marker < 0 ? -1 : html.indexOf('{', marker)
  if (start < 0) throw new AppError('NETWORK', UNREADABLE_PAGE)
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      try {
        const data = JSON.parse(html.slice(start, i + 1)) as IgSearchResults
        if (data && typeof data === 'object' && Array.isArray(data.hits)) return data
      } catch {
        // Falls through to the error below.
      }
      break
    }
  }
  throw new AppError('NETWORK', UNREADABLE_PAGE)
}

const sellableHere = (hit: IgHit) =>
  !hit.country_blacklist?.includes(COUNTRY) &&
  (!hit.country_whitelist?.length ||
    hit.country_whitelist.some((c) => c === COUNTRY || /^(ww|worldwide)$/i.test(c)))

/**
 * PC editions sold in France whose title is the wanted one (`normalizeTitle`: no DLC, no
 * other edition, no console key), in stock first, then cheapest (a Steam key first on a tie).
 * Out of stock editions are kept (shown as such); a price of 0 means "not sold".
 */
export function matchInstantGaming(data: IgSearchResults, title: string): IgProduct[] {
  const wanted = normalizeTitle(title)
  if (!wanted) return []
  const seen = new Set<string>()
  const products: IgProduct[] = []
  for (const hit of Array.isArray(data.hits) ? data.hits : []) {
    const id = hit?.prod_id !== undefined ? String(hit.prod_id) : ''
    const amount = Number(hit?.price_eur ?? hit?.price)
    if (
      !/^\d+$/.test(id) ||
      seen.has(id) ||
      !hit.seo_name ||
      !/^[a-z0-9-]+$/.test(hit.seo_name) ||
      !hit.platforms?.includes(PC) ||
      hit.is_dlc ||
      hit.is_draft ||
      hit.is_free_to_play ||
      hit.is_prepaid ||
      hit.is_subscription ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !sellableHere(hit) ||
      ![hit.name, hit.en_name, hit.small_name].some((n) => n && normalizeTitle(n) === wanted)
    ) {
      continue
    }
    seen.add(id)
    products.push({
      id,
      slug: hit.seo_name,
      name: hit.fullname || hit.name || title,
      platform: hit.type || 'PC',
      amount,
      inStock: hit.has_stock === 1,
      preorder: hit.preorder === 1
    })
  }
  return products.sort(
    (a, b) =>
      Number(b.inStock) - Number(a.inStock) ||
      a.amount - b.amount ||
      Number(b.platform === 'Steam') - Number(a.platform === 'Steam')
  )
}

/** "24,50 €", "1 234,56 €" → 24.5, 1234.56; "Gratuit" → 0; anything else → null. */
export function parseEuros(text: string | null | undefined): number | null {
  if (!text) return null
  if (/^gratuit$/i.test(text.trim())) return 0
  // `\s` also covers the no-break spaces of formatted prices.
  const match = text.replace(/\s/g, '').match(/^(\d+(?:[.,]\d{1,2})?)€$/)
  return match ? Number(match[1]!.replace(',', '.')) : null
}

/**
 * Instant Gaming's own discount compares its price with a list price, so every game looks on
 * sale there. What matters is the official store's current price (Steam, sales included):
 * `versus.diffPct` < 0 when the key is cheaper, > 0 when the official store is cheaper.
 */
export function toKeyshopOffer(
  product: IgProduct,
  official: { storeName: string; price: string } | null
): KeyshopOffer {
  const officialAmount = official ? parseEuros(official.price) : null
  return {
    shopName: INSTANT_GAMING,
    productId: product.id,
    slug: product.slug,
    name: product.name,
    platform: product.platform,
    price: formatEur(product.amount),
    amount: product.amount,
    inStock: product.inStock,
    preorder: product.preorder,
    versus:
      official && officialAmount
        ? {
            storeName: official.storeName,
            price: official.price,
            diffPct: Math.round(((product.amount - officialAmount) / officialAmount) * 100)
          }
        : null
  }
}

export class InstantGamingClient {
  constructor(
    private readonly userAgent: string,
    private readonly fetch?: FetchLike
  ) {}

  async search(title: string): Promise<IgSearchResults> {
    const html = await requestText(
      instantGamingSearchUrl(title),
      { headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'fr-FR,fr;q=0.9' } },
      { service: INSTANT_GAMING, fetch: this.fetch }
    ).catch((error: unknown) => {
      throw error instanceof AppError && error.code === 'AUTH'
        ? new AppError('NETWORK', BLOCKED)
        : error
    })
    return extractSearchResults(html)
  }
}
