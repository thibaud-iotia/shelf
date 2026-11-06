import type { LocalPrice } from '../../shared/models'
import { normalizeTitle } from '../games/titles'
import { requestJson, type FetchLike } from '../net/http'

// GOG catalog (public, no key): product id (Galaxy store page), slug (web page) and price in
// euros of a game found by its exact title. Checked live on 2026-11-06
// (tests/fixtures/api/gog-catalog.json).

const CATALOG = 'https://catalog.gog.com/v1/catalog'

export const gogGalaxyUri = (productId: string) => `goggalaxy://openGameView/${productId}`
export const gogStoreUrl = (slug: string) => `https://www.gog.com/game/${slug}`

export interface GogCatalogResponse {
  products?: {
    id?: string
    slug?: string
    title?: string
    productType?: string
    price?: { final?: string; base?: string; discount?: string | null } | null
  }[]
}

export interface GogProduct {
  id: string
  slug: string
  price: LocalPrice | null
}

/** "49,99 €" with a regular space (GOG uses a no-break space). */
const clean = (price: string) => price.replace(/\s/g, ' ').trim()

/** First product whose normalized title equals the wanted one, or null. */
export function matchGogProduct(data: GogCatalogResponse, title: string): GogProduct | null {
  const wanted = normalizeTitle(title)
  if (!wanted) return null
  const hit = (data.products ?? []).find(
    (p) => p.id && p.slug && p.title && normalizeTitle(p.title) === wanted
  )
  if (!hit?.id || !hit.slug) return null
  let price: LocalPrice | null = null
  if (hit.price?.final) {
    const discountPct = Math.abs(Number.parseInt(hit.price.discount ?? '', 10)) || 0
    price = {
      final: hit.price.final.startsWith('0,00') ? 'Gratuit' : clean(hit.price.final),
      base: discountPct > 0 && hit.price.base ? clean(hit.price.base) : null,
      discountPct
    }
  }
  return { id: hit.id, slug: hit.slug, price }
}

export class GogCatalogClient {
  constructor(private readonly fetch?: FetchLike) {}

  search(title: string): Promise<GogCatalogResponse> {
    const query = new URLSearchParams({
      limit: '10',
      query: `like:${title}`,
      order: 'desc:score',
      productType: 'in:game,pack',
      countryCode: 'FR',
      locale: 'fr-FR',
      currencyCode: 'EUR'
    })
    return requestJson(`${CATALOG}?${query}`, {}, { service: 'GOG', fetch: this.fetch })
  }
}
