import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatEur } from '../../src/shared/format'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { assertAllowed } from '../../src/main/net/http'
import {
  extractSearchResults,
  instantGamingProductUrl,
  instantGamingSearchUrl,
  matchInstantGaming,
  parseEuros,
  toKeyshopOffer,
  BLOCKED,
  UNREADABLE_PAGE,
  type IgHit,
  type IgProduct
} from '../../src/main/store/instant-gaming'
import { purchaseTarget } from '../../src/main/store/purchase'
import { StoreService, type StoreDeps } from '../../src/main/store/service'
import { validatePurchase } from '../../src/main/store/validation'
import type { PendingPurchase } from '../../src/main/store/watcher'
import { fakeFetch, FIXTURES, json, MIGRATIONS } from './helpers'

// Search pages recorded on 2026-11-08 ("elden ring": 18 editions for every platform, DLC
// included; "hades ii": every PC edition out of stock).
const page = (name: string) => readFileSync(join(FIXTURES, 'api', name), 'utf8')
const ELDEN_RING = page('instant-gaming-search.html')
const HADES_II = page('instant-gaming-search-hades.html')

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=UTF-8' } })

/** A hit that passes every filter, to tweak one field at a time. */
const hit = (patch: Partial<IgHit> = {}): IgHit => ({
  prod_id: 1,
  name: 'Owlboy',
  fullname: 'Owlboy - PC (Steam)',
  seo_name: 'owlboy-pc-steam',
  type: 'Steam',
  platforms: ['1'],
  is_dlc: 0,
  is_draft: 0,
  preorder: 0,
  has_stock: 1,
  price_eur: '9.99',
  country_whitelist: null,
  country_blacklist: null,
  ...patch
})

describe('Instant Gaming search page', () => {
  it('reads the results embedded in the page', () => {
    const results = extractSearchResults(ELDEN_RING)
    expect(results.hits).toHaveLength(18)
    expect(results.hits![0]).toMatchObject({ prod_id: 4824, name: 'Elden Ring', type: 'Steam' })
    expect(extractSearchResults(HADES_II).hits).toHaveLength(3)
  })

  it('reads up to the closing brace, even with braces and quotes inside strings', () => {
    const results = extractSearchResults(
      '<script>window.searchResults = {"hits":[{"name":"a}\\"{b"}],"nbHits":1};' +
        ' var other = {"x": 1};</script>'
    )
    expect(results.hits).toEqual([{ name: 'a}"{b' }])
  })

  it('explains a page that changed', () => {
    expect(() => extractSearchResults('<html>Cloudflare</html>')).toThrow(UNREADABLE_PAGE)
    expect(() => extractSearchResults('window.searchResults = {"hits": [')).toThrow(UNREADABLE_PAGE)
    expect(() => extractSearchResults('window.searchResults = {"nbHits": 0};')).toThrow(
      UNREADABLE_PAGE
    )
    expect(extractSearchResults('window.searchResults = {"hits":[],"nbHits":0};').hits).toEqual([])
  })

  it('builds the search and product URLs, allowed by the network gate', () => {
    expect(instantGamingSearchUrl('Clair Obscur: Expedition 33')).toBe(
      'https://www.instant-gaming.com/fr/rechercher/?q=Clair+Obscur%3A+Expedition+33'
    )
    expect(instantGamingProductUrl('4824', 'elden-ring-pc-steam')).toBe(
      'https://www.instant-gaming.com/fr/4824-acheter-elden-ring-pc-steam/'
    )
    expect(() => assertAllowed(instantGamingSearchUrl('hades'))).not.toThrow()
  })
})

describe('Instant Gaming matching', () => {
  it('keeps the PC edition of this exact game: no DLC, other edition or console key', () => {
    const products = matchInstantGaming(extractSearchResults(ELDEN_RING), 'ELDEN RING™')
    expect(products).toEqual([
      {
        id: '4824',
        slug: 'elden-ring-pc-steam',
        name: 'Elden Ring - PC (Steam)',
        platform: 'Steam',
        amount: 45.99,
        inStock: true,
        preorder: false
      }
    ])
    expect(matchInstantGaming(extractSearchResults(ELDEN_RING), 'Elden Ring Nightreign')).toEqual([
      expect.objectContaining({ id: '18294', inStock: false, amount: 29.9 })
    ])
  })

  it('lists every PC key of the game, in stock first, then cheapest', () => {
    const products = matchInstantGaming(extractSearchResults(HADES_II), 'Hades II')
    // Both out of stock; the Switch edition (no price, not PC) is left out.
    expect(products.map((p) => [p.platform, p.amount, p.inStock])).toEqual([
      ['Steam', 16.2, false],
      ['Microsoft Store', 25.29, false]
    ])
    const inStock = matchInstantGaming(
      {
        hits: [
          hit({ prod_id: 1, price_eur: '5.00', has_stock: 0 }),
          hit({ prod_id: 2, price_eur: '9.00', type: 'Epic Games' }),
          hit({ prod_id: 3, price_eur: '9.00', type: 'Steam' })
        ]
      },
      'Owlboy'
    )
    // In stock first; same price: the Steam key first.
    expect(inStock.map((p) => p.id)).toEqual(['3', '2', '1'])
  })

  it('leaves out what cannot be bought here or is not a game key', () => {
    const one = (patch: Partial<IgHit>) => matchInstantGaming({ hits: [hit(patch)] }, 'Owlboy')
    expect(one({})).toHaveLength(1)
    expect(one({ name: 'Owlboy 2' })).toEqual([])
    expect(one({ name: 'Le Hibou', en_name: 'Owlboy' })).toHaveLength(1)
    expect(one({ is_dlc: 1 })).toEqual([])
    expect(one({ is_draft: 1 })).toEqual([])
    expect(one({ is_subscription: 1 })).toEqual([])
    expect(one({ is_free_to_play: 1 })).toEqual([])
    expect(one({ platforms: ['9'] })).toEqual([])
    expect(one({ price_eur: '0.00' })).toEqual([])
    expect(one({ price_eur: undefined, price: '4.50' })[0]?.amount).toBe(4.5)
    expect(one({ country_whitelist: ['US', 'CA'] })).toEqual([])
    expect(one({ country_whitelist: ['worldwide'] })).toHaveLength(1)
    expect(one({ country_whitelist: ['DE', 'FR'] })).toHaveLength(1)
    expect(one({ country_blacklist: ['FR'] })).toEqual([])
    // Values that end up in a URL are checked.
    expect(one({ seo_name: '../x' })).toEqual([])
    expect(one({ prod_id: '1/2' })).toEqual([])
    expect(one({ preorder: 1 })[0]?.preorder).toBe(true)
    expect(matchInstantGaming({ hits: [hit(), hit()] }, 'Owlboy')).toHaveLength(1)
    expect(matchInstantGaming({}, 'Owlboy')).toEqual([])
    expect(matchInstantGaming({ hits: [hit()] }, '™')).toEqual([])
  })
})

describe('Instant Gaming prices', () => {
  const product: IgProduct = {
    id: '4824',
    slug: 'elden-ring-pc-steam',
    name: 'Elden Ring - PC (Steam)',
    platform: 'Steam',
    amount: 45.99,
    inStock: true,
    preorder: false
  }

  it('reads and writes prices in euros', () => {
    expect(parseEuros('24,50 €')).toBe(24.5)
    expect(parseEuros('24,50€')).toBe(24.5)
    expect(parseEuros('1 234,56 €')).toBe(1234.56)
    expect(parseEuros('1 234,56 €')).toBe(1234.56)
    expect(parseEuros('Gratuit')).toBe(0)
    expect(parseEuros('24,99 $')).toBeNull()
    expect(parseEuros(null)).toBeNull()
    expect(formatEur(45.99)).toBe('45,99 €')
    expect(formatEur(16.2)).toBe('16,20 €')
    expect(formatEur(1234.5)).toBe('1 234,50 €')
  })

  it('compares with the official price, not with the reseller’s list price', () => {
    const offer = toKeyshopOffer(product, { storeName: 'Steam', price: '59,99 €' })
    expect(offer).toMatchObject({
      shopName: 'Instant Gaming',
      price: '45,99 €',
      versus: { storeName: 'Steam', price: '59,99 €', diffPct: -23 }
    })
    // Steam on sale is cheaper than the key.
    expect(toKeyshopOffer(product, { storeName: 'Steam', price: '29,99 €' }).versus?.diffPct).toBe(
      53
    )
    expect(toKeyshopOffer(product, { storeName: 'Steam', price: '45,99 €' }).versus?.diffPct).toBe(
      0
    )
    expect(toKeyshopOffer(product, null).versus).toBeNull()
    expect(toKeyshopOffer(product, { storeName: 'Steam', price: 'Gratuit' }).versus).toBeNull()
  })
})

describe('Instant Gaming purchase', () => {
  const env = { platform: 'win32' as const, steam: true, gogGalaxy: true }
  const ig = { id: '4824', slug: 'elden-ring-pc-steam', platform: 'Steam' }

  it('opens the product page in the browser', () => {
    expect(
      purchaseTarget(
        { storeId: 'ig', dealId: null, steamAppId: '1245620', gog: null, instantGaming: ig },
        env
      )
    ).toEqual({
      url: 'https://www.instant-gaming.com/fr/4824-acheter-elden-ring-pc-steam/',
      opensIn: 'browser'
    })
    expect(purchaseTarget({ storeId: 'ig', dealId: null, steamAppId: null, gog: null }, env)).toBe(
      null
    )
  })

  it('validates the product sent by the renderer', () => {
    const base = { title: 'Elden Ring', steamAppId: null, cheapsharkId: null, dealId: null }
    expect(validatePurchase({ ...base, storeId: 'ig', instantGaming: ig }).instantGaming).toEqual(
      ig
    )
    expect(validatePurchase({ ...base, storeId: '1' }).instantGaming).toBeNull()
    expect(() => validatePurchase({ ...base, storeId: 'ig' })).toThrow(/Instant Gaming/)
    expect(() =>
      validatePurchase({ ...base, storeId: 'ig', instantGaming: { ...ig, slug: '../../x' } })
    ).toThrow(/Instant Gaming/)
    expect(() =>
      validatePurchase({ ...base, storeId: 'ig', instantGaming: { ...ig, id: '1?x=1' } })
    ).toThrow(/Instant Gaming/)
    expect(() =>
      validatePurchase({ ...base, storeId: 'ig', instantGaming: { ...ig, platform: 3 } })
    ).toThrow(/Instant Gaming/)
    expect(() => validatePurchase({ ...base, storeId: 'igx' })).toThrow(/Magasin/)
  })
})

describe('StoreService key resellers', () => {
  let handle: DatabaseHandle
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
  })
  afterEach(() => handle.close())

  /** Elden Ring at 59,99 € on Steam. */
  const STEAM_ITEMS = {
    response: {
      store_items: [
        {
          appid: 1245620,
          success: 1,
          name: 'ELDEN RING',
          best_purchase_option: { formatted_final_price: '59,99€', discount_pct: 0 }
        }
      ]
    }
  }

  const service = (fetch: ReturnType<typeof fakeFetch>, patch: Partial<StoreDeps> = {}) => {
    const opened: string[] = []
    const watched: PendingPurchase[] = []
    const store = new StoreService({
      db: handle.db,
      steamId: () => null,
      launcherAvailable: async () => true,
      openExternal: async (url) => {
        opened.push(url)
      },
      watchPurchase: (p) => watched.push(p),
      userAgent: 'Shelf/test',
      platform: 'win32',
      fetch,
      ...patch
    })
    return { store, opened, watched }
  }

  it('finds the key, compares it with Steam and keeps the answer in cache', async () => {
    const fetch = fakeFetch([
      ['instant-gaming.com/fr/rechercher/', () => html(ELDEN_RING)],
      ['IStoreBrowseService/GetItems', () => json(STEAM_ITEMS)]
    ])
    const { store } = service(fetch)
    const ref = { title: 'Elden Ring', steamAppId: '1245620', cheapsharkId: null }
    const view = await store.keyshops(ref)
    expect(view.error).toBeNull()
    expect(view.offers).toEqual([
      {
        shopName: 'Instant Gaming',
        productId: '4824',
        slug: 'elden-ring-pc-steam',
        name: 'Elden Ring - PC (Steam)',
        platform: 'Steam',
        price: '45,99 €',
        amount: 45.99,
        inStock: true,
        preorder: false,
        versus: { storeName: 'Steam', price: '59,99 €', diffPct: -23 }
      }
    ])
    const search = fetch.calls.find((c) => c.url.includes('instant-gaming'))!
    expect(search.url).toBe('https://www.instant-gaming.com/fr/rechercher/?q=Elden+Ring')
    expect((search.init?.headers as Record<string, string>)['User-Agent']).toBe('Shelf/test')
    // Second look within the cache lifetime: no new request.
    const calls = fetch.calls.length
    await store.keyshops(ref)
    expect(fetch.calls.length).toBe(calls)
  })

  it('shows the key without comparison when the game is not on Steam', async () => {
    const fetch = fakeFetch([['instant-gaming.com', () => html(HADES_II)]])
    const { store } = service(fetch)
    const view = await store.keyshops({ title: 'Hades II', steamAppId: null, cheapsharkId: null })
    expect(view.offers.map((o) => [o.price, o.inStock, o.versus])).toEqual([
      ['16,20 €', false, null],
      ['25,29 €', false, null]
    ])
    expect(fetch.calls.some((c) => c.url.includes('steampowered'))).toBe(false)
  })

  it('never fails: the error is returned and is not cached', async () => {
    let answer = () => html('', 403)
    const fetch = fakeFetch([
      ['instant-gaming.com', () => answer()],
      ['GetItems', () => json(STEAM_ITEMS)]
    ])
    const { store } = service(fetch)
    const ref = { title: 'Elden Ring', steamAppId: '1245620', cheapsharkId: null }
    expect(await store.keyshops(ref)).toEqual({ offers: [], error: BLOCKED })
    answer = () => html('', 429)
    expect((await store.keyshops(ref)).error).toMatch(/Trop de requêtes vers Instant Gaming/)
    answer = () => html('<html><body>Nouvelle page</body></html>')
    expect(await store.keyshops(ref)).toEqual({ offers: [], error: UNREADABLE_PAGE })
    answer = () => html(ELDEN_RING)
    expect((await store.keyshops(ref)).offers).toHaveLength(1)
    expect(await store.keyshops({ ...ref, title: '  ' })).toEqual({ offers: [], error: null })
  })

  it('opens the product page and follows the key’s launcher', async () => {
    const { store, opened, watched } = service(fakeFetch([]))
    const result = await store.buy({
      title: 'Elden Ring',
      steamAppId: '1245620',
      cheapsharkId: null,
      storeId: 'ig',
      dealId: null,
      gog: null,
      instantGaming: { id: '4824', slug: 'elden-ring-pc-steam', platform: 'Steam' }
    })
    expect(result.opensIn).toBe('browser')
    expect(opened).toEqual(['https://www.instant-gaming.com/fr/4824-acheter-elden-ring-pc-steam/'])
    expect(watched).toEqual([{ title: 'Elden Ring', steamAppId: '1245620', source: 'steam' }])

    await store.buy({
      title: 'The Witcher 3',
      steamAppId: null,
      cheapsharkId: null,
      storeId: 'ig',
      dealId: null,
      gog: null,
      instantGaming: { id: '1', slug: 'the-witcher-3-gog', platform: 'GOG.com' }
    })
    await store.buy({
      title: 'Hades II',
      steamAppId: null,
      cheapsharkId: null,
      storeId: 'ig',
      dealId: null,
      gog: null,
      instantGaming: { id: '22189', slug: 'hades-ii-ms', platform: 'Microsoft Store' }
    })
    expect(watched.slice(1).map((w) => w.source)).toEqual(['gog', null])
  })
})
