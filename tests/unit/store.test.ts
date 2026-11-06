import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreGameRef } from '../../src/shared/models'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import { parseRemoteImageUrl } from '../../src/main/media/remote'
import { assertAllowed, IMAGE_HOSTS } from '../../src/main/net/http'
import {
  bestBySteamApp,
  bestOfGame,
  dealRedirectUrl,
  parseStores,
  steamAppIdOf,
  uniqueDeals,
  type CsDeal,
  type CsGame,
  type CsStore
} from '../../src/main/store/cheapshark'
import { matchGogProduct, type GogCatalogResponse } from '../../src/main/store/gog'
import { purchaseTarget, type PurchaseEnv } from '../../src/main/store/purchase'
import {
  StoreService,
  WISHLIST_EMPTY_OR_PRIVATE,
  type StoreDeps
} from '../../src/main/store/service'
import {
  parseStoreItems,
  parseWishlist,
  type StoreItemsResponse,
  type WishlistResponse
} from '../../src/main/store/steam'
import {
  validatePurchase,
  validateSteamAppId,
  validateStoreGameRef,
  validateStoreQuery
} from '../../src/main/store/validation'
import { PurchaseWatcher, type PendingPurchase } from '../../src/main/store/watcher'
import {
  addWish,
  dropBought,
  listWishlist,
  ownedIndex,
  removeWish,
  STEAM_WISH_REMOVE,
  syncSteamWishlist
} from '../../src/main/store/wishlist'
import { apiFixture, fakeFetch, json, MIGRATIONS } from './helpers'

const stores = () => parseStores(apiFixture('cheapshark-stores.json') as CsStore[])

describe('CheapShark parsers', () => {
  it('names stores, with a fallback for unknown ids', () => {
    const names = stores()
    expect(names.get('1')).toBe('Steam')
    expect(names.get('7')).toBe('GOG')
    expect(names.get('25')).toBe('Epic Games Store')
    expect(parseStores([]).get('7')).toBe('GOG')
  })

  it('keeps the cheapest deal per Steam appid, Steam first on a tie', () => {
    const best = bestBySteamApp(apiFixture('cheapshark-deals-steam.json') as CsDeal[], stores())
    expect(best.get('1145360')).toMatchObject({ storeId: '1', storeName: 'Steam', price: 24.99 })
    // Hades II: same price on Epic and Steam → Steam.
    expect(best.get('1145350')).toMatchObject({ storeId: '1', price: 29.99 })
    expect(best.get('292030')?.price).toBe(49.99)
  })

  it('lists one deal per game and reads a game sheet', () => {
    const deals = uniqueDeals(apiFixture('cheapshark-deals.json') as CsDeal[])
    expect(deals).toHaveLength(11)
    expect(deals.filter((d) => d.title === 'Owlboy')).toHaveLength(1)
    const game = apiFixture('cheapshark-game.json') as CsGame
    expect(bestOfGame(game, stores())).toMatchObject({ price: 49.99, discountPct: 0 })
    expect(bestOfGame({ ...game, deals: [] }, stores())).toBeNull()
  })

  it('validates Steam appids and builds the purchase redirect once encoded', () => {
    expect(steamAppIdOf('292030')).toBe('292030')
    expect(steamAppIdOf('0')).toBeNull()
    expect(steamAppIdOf(null)).toBeNull()
    expect(dealRedirectUrl('%2FRRv%3D')).toBe(
      'https://www.cheapshark.com/redirect?dealID=%2FRRv%3D'
    )
  })
})

describe('Steam store side', () => {
  it('orders the wishlist by priority, unranked last', () => {
    expect(parseWishlist(apiFixture('steam-wishlist.json') as WishlistResponse)).toEqual([
      { appId: '1145350', addedAt: 1760000000000 },
      { appId: '292030', addedAt: 1750000000000 },
      { appId: '1145360', addedAt: 1770000000000 }
    ])
    expect(parseWishlist({ response: {} })).toEqual([])
  })

  it('reads names, hashed header images and prices in euros', () => {
    const items = parseStoreItems(apiFixture('steam-store-items.json') as StoreItemsResponse)
    const hades = items.get('1145360')!
    expect(hades.name).toBe('Hades')
    expect(hades.price).toEqual({ final: '24,50 €', base: null, discountPct: 0 })
    expect(hades.heroUrl).toMatch(/\/steam\/apps\/1145360\/library_hero\.jpg/)
    expect(items.get('1145350')!.imageUrl).toMatch(
      /^https:\/\/shared\.fastly\.steamstatic\.com\/store_item_assets\/steam\/apps\/1145350\/.+\/header\.jpg/
    )
    const discounted = parseStoreItems({
      response: {
        store_items: [
          {
            appid: 1,
            success: 1,
            name: 'X',
            best_purchase_option: {
              formatted_final_price: '9,99€',
              formatted_original_price: '19,99€',
              discount_pct: 50
            }
          },
          { appid: 2, success: 1, name: 'Free', is_free: true }
        ]
      }
    })
    expect(discounted.get('1')!.price).toEqual({
      final: '9,99 €',
      base: '19,99 €',
      discountPct: 50
    })
    expect(discounted.get('2')!.price?.final).toBe('Gratuit')
  })
})

describe('GOG catalog', () => {
  it('finds the product with the exact title and its price in euros', () => {
    const data = apiFixture('gog-catalog.json') as GogCatalogResponse
    const product = matchGogProduct(data, 'The Witcher 3: Wild Hunt — Remastered')
    expect(product).toMatchObject({ id: '1640424747', slug: expect.stringContaining('witcher_3') })
    expect(product!.price?.final).toBe('49,99 €')
    expect(matchGogProduct(data, 'Hades')).toBeNull()
  })
})

describe('purchase target', () => {
  const env = (patch: Partial<PurchaseEnv> = {}): PurchaseEnv => ({
    platform: 'win32',
    steam: true,
    gogGalaxy: true,
    ...patch
  })
  const steamOffer = { storeId: '1', dealId: 'abc', steamAppId: '292030', gog: null }
  const gogOffer = { storeId: '7', dealId: 'abc', steamAppId: null, gog: { id: '9', slug: 'w3' } }

  it('opens the Steam client when installed, the Steam site otherwise', () => {
    expect(purchaseTarget(steamOffer, env())).toEqual({
      url: 'steam://store/292030',
      opensIn: 'steam'
    })
    expect(purchaseTarget(steamOffer, env({ steam: false }))).toEqual({
      url: 'https://store.steampowered.com/app/292030/',
      opensIn: 'browser'
    })
  })

  it('opens GOG Galaxy (not on Linux), else the GOG page', () => {
    expect(purchaseTarget(gogOffer, env())?.url).toBe('goggalaxy://openGameView/9')
    expect(purchaseTarget(gogOffer, env({ platform: 'linux' }))?.url).toBe(
      'https://www.gog.com/game/w3'
    )
    expect(purchaseTarget(gogOffer, env({ gogGalaxy: false }))?.opensIn).toBe('browser')
  })

  it('sends the other stores (Epic…) to CheapShark’s link in the browser', () => {
    expect(
      purchaseTarget({ storeId: '25', dealId: 'd%3D', steamAppId: null, gog: null }, env())
    ).toEqual({ url: 'https://www.cheapshark.com/redirect?dealID=d%3D', opensIn: 'browser' })
    expect(
      purchaseTarget({ storeId: '25', dealId: null, steamAppId: null, gog: null }, env())
    ).toBeNull()
  })
})

describe('network allow-list', () => {
  it('allows the store services and their images', () => {
    expect(() => assertAllowed('https://www.cheapshark.com/api/1.0/stores')).not.toThrow()
    expect(() => assertAllowed('https://catalog.gog.com/v1/catalog')).not.toThrow()
    expect(IMAGE_HOSTS.has('cdn1.epicgames.com')).toBe(true)
    expect(IMAGE_HOSTS.has('images.gog-statics.com')).toBe(true)
  })
})

describe('validation', () => {
  it('accepts store references and purchases, refuses forged values', () => {
    expect(
      validateStoreGameRef({ title: ' Hades ', steamAppId: '1145360', cheapsharkId: null })
    ).toMatchObject({ title: 'Hades', steamAppId: '1145360', cheapsharkId: null })
    expect(() => validateStoreGameRef({ title: 'x', steamAppId: '12;rm' })).toThrow(/AppID/)
    expect(() => validateStoreGameRef({ title: '', steamAppId: null })).toThrow()
    const purchase = validatePurchase({
      title: 'W3',
      steamAppId: null,
      cheapsharkId: '332562',
      storeId: '7',
      dealId: 'OR%2BVz0QIAULaNU5tjUdvoTs3iqGm6lodrS%2BXzXvxPXg%3D',
      gog: { id: '1640424747', slug: 'the_witcher_3' }
    })
    expect(purchase.gog).toEqual({ id: '1640424747', slug: 'the_witcher_3' })
    expect(() =>
      validatePurchase({ title: 'x', steamAppId: '1', storeId: '1', dealId: 'a b' })
    ).toThrow(/Offre/)
    expect(() =>
      validatePurchase({
        title: 'x',
        steamAppId: '1',
        storeId: '7',
        gog: { id: '1', slug: '../x' }
      })
    ).toThrow(/GOG/)
    expect(validateStoreQuery('  hades ')).toBe('hades')
    expect(validateSteamAppId('292030')).toBe('292030')
    expect(() => validateSteamAppId('')).toThrow(/AppID/)
    expect(() => validateSteamAppId('../1')).toThrow(/AppID/)
    expect(() => validateStoreQuery('x'.repeat(101))).toThrow()
  })
})

describe('wishlist', () => {
  let handle: DatabaseHandle
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
  })
  afterEach(() => handle.close())

  const steamWish = (appId: string, title = `Game ${appId}`) => ({
    appId,
    title,
    imageUrl: null,
    addedAt: null
  })

  it('mirrors the Steam wishlist and keeps what the user added', () => {
    const { db } = handle
    syncSteamWishlist(db, [steamWish('1'), steamWish('2')])
    addWish(db, { title: 'Game 2', steamAppId: '2', cheapsharkId: null })
    addWish(db, { title: 'Other', steamAppId: null, cheapsharkId: '99' })
    syncSteamWishlist(db, [steamWish('3')])
    const rows = listWishlist(db)
    expect(rows.map((r) => r.steamAppId ?? r.cheapsharkId).sort()).toEqual(['2', '3', '99'])
    expect(rows.find((r) => r.steamAppId === '2')).toMatchObject({ fromSteam: false, byUser: true })
  })

  it('removes Shelf entries, explains Steam ones', () => {
    const { db } = handle
    syncSteamWishlist(db, [steamWish('1')])
    const steamRow = listWishlist(db)[0]!
    expect(() => removeWish(db, steamRow.id)).toThrow(STEAM_WISH_REMOVE)
    const own = addWish(db, { title: 'Mine', steamAppId: null, cheapsharkId: '5' })
    removeWish(db, own.id)
    expect(listWishlist(db)).toHaveLength(1)
    expect(() => addWish(db, { title: 'x', steamAppId: null, cheapsharkId: null })).toThrow()
  })

  it('drops a bought game from the Shelf list (Steam entries leave at the next sync)', () => {
    const { db } = handle
    syncSteamWishlist(db, [steamWish('1', 'Hades')])
    addWish(db, { title: 'Hades', steamAppId: '1', cheapsharkId: null })
    addWish(db, { title: 'Hades II', steamAppId: null, cheapsharkId: '7' })
    dropBought(db, { title: 'Hades', steamAppId: '1' })
    const rows = listWishlist(db)
    expect(rows.map((r) => r.title).sort()).toEqual(['Hades', 'Hades II'])
    expect(rows.find((r) => r.title === 'Hades')).toMatchObject({ fromSteam: true, byUser: false })
    dropBought(db, { title: 'HADES II', steamAppId: null })
    expect(listWishlist(db)).toHaveLength(1)
  })

  it('finds owned games by Steam appid, matched appid or title', () => {
    const { db } = handle
    db.insert(games)
      .values([
        { title: 'Hades', source: 'steam', sourceId: '1145360' },
        { title: 'The Witcher 3', source: 'gog', sourceId: '42', steamAppId: '292030' },
        { title: 'Celeste', source: 'manual', sourceId: 'uuid' }
      ])
      .run()
    const owned = ownedIndex(db)
    expect(owned.find({ steamAppId: '1145360', title: '' })).not.toBeNull()
    expect(owned.find({ steamAppId: '292030', title: 'x' })).not.toBeNull()
    expect(owned.find({ steamAppId: null, title: 'CELESTE™' })).not.toBeNull()
    expect(owned.find({ steamAppId: '5', title: 'Nope' })).toBeNull()
  })
})

describe('StoreService', () => {
  let handle: DatabaseHandle
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
  })
  afterEach(() => handle.close())

  const routes = () =>
    fakeFetch([
      ['cheapshark.com/api/1.0/stores', () => json(apiFixture('cheapshark-stores.json'))],
      [
        'cheapshark.com/api/1.0/deals?steamAppID',
        () => json(apiFixture('cheapshark-deals-steam.json'))
      ],
      ['cheapshark.com/api/1.0/deals?', () => json(apiFixture('cheapshark-deals.json'))],
      ['cheapshark.com/api/1.0/games?id=', () => json(apiFixture('cheapshark-game.json'))],
      [
        'cheapshark.com/api/1.0/games?steamAppID=',
        () =>
          json([
            {
              gameID: '332562',
              steamAppID: '292030',
              cheapest: '49.99',
              cheapestDealID: 'x',
              external: 'The Witcher 3'
            }
          ])
      ],
      ['cheapshark.com/api/1.0/games?title=', () => json(apiFixture('cheapshark-search.json'))],
      [
        'cheapshark.com/api/1.0/games?ids=',
        () => json({ '196149': apiFixture('cheapshark-game.json') })
      ],
      ['IWishlistService/GetWishlist', () => json(apiFixture('steam-wishlist.json'))],
      ['IStoreBrowseService/GetItems', () => json(apiFixture('steam-store-items.json'))],
      ['catalog.gog.com', () => json(apiFixture('gog-catalog.json'))]
    ])

  const service = (patch: Partial<StoreDeps> = {}, fetch = routes()) => {
    const opened: string[] = []
    const watched: PendingPurchase[] = []
    const store = new StoreService({
      db: handle.db,
      steamId: () => '76561198000000000',
      launcherAvailable: async (source) => source === 'steam',
      openExternal: async (url) => {
        opened.push(url)
      },
      watchPurchase: (p) => watched.push(p),
      userAgent: 'Shelf/test',
      platform: 'win32',
      fetch,
      ...patch
    })
    return { store, opened, watched, fetch }
  }

  it('imports the Steam wishlist with names, prices in euros and best deals', async () => {
    const { store, fetch } = service()
    const view = await store.wishlist()
    expect(view.steam).toMatchObject({ connected: true, error: null })
    expect(view.items.map((i) => i.title).sort()).toEqual([
      'Hades',
      'Hades II',
      'The Witcher 3: Wild Hunt — Remastered'
    ])
    const hades = view.items.find((i) => i.steamAppId === '1145360')!
    expect(hades.steamPrice?.final).toBe('24,50 €')
    expect(hades.best).toMatchObject({ storeName: 'Steam', price: 24.99 })
    expect(hades.wishlist).toMatchObject({ fromSteam: true, byUser: false })
    expect(parseRemoteImageUrl(hades.imageUrl!)).toMatch(/steamstatic\.com/)
    expect(view.pricesError).toBeNull()
    // CheapShark needs a descriptive user agent.
    const cs = fetch.calls.find((c) => c.url.includes('cheapshark'))!
    expect((cs.init?.headers as Record<string, string>)['User-Agent']).toBe('Shelf/test')
    // No second import within the hour, prices served from the cache.
    const calls = fetch.calls.length
    await store.wishlist()
    expect(fetch.calls.length).toBe(calls)
    await store.wishlist({ forceSync: true })
    expect(fetch.calls.filter((c) => c.url.includes('GetWishlist'))).toHaveLength(2)
  })

  it('explains an empty or private Steam wishlist and lists prices failures', async () => {
    const fetch = fakeFetch([
      ['GetWishlist', () => json({ response: {} })],
      ['cheapshark', () => json({}, 500)]
    ])
    const { store } = service({}, fetch)
    addWish(handle.db, { title: 'Owlboy', steamAppId: null, cheapsharkId: '158317' })
    const view = await store.wishlist()
    expect(view.steam.error).toBe(WISHLIST_EMPTY_OR_PRIVATE)
    expect(view.items).toHaveLength(1)
    expect(view.items[0]!.best).toBeNull()
    expect(view.pricesError).toMatch(/CheapShark/)
  })

  it('works without a Steam account', async () => {
    const { store, fetch } = service({ steamId: () => null })
    const view = await store.wishlist()
    expect(view.steam.connected).toBe(false)
    expect(view.items).toEqual([])
    expect(fetch.calls.some((c) => c.url.includes('GetWishlist'))).toBe(false)
  })

  it('lists deals once per game and flags owned and wished games', async () => {
    handle.db.insert(games).values({ title: 'Owlboy', source: 'steam', sourceId: '115800' }).run()
    addWish(handle.db, { title: 'Metro Exodus', steamAppId: '412020', cheapsharkId: null })
    const { store } = service()
    const deals = await store.deals()
    expect(deals).toHaveLength(11)
    expect(deals.find((d) => d.title === 'Owlboy')!.ownedGameId).not.toBeNull()
    expect(deals.find((d) => d.title === 'Metro Exodus')!.wishlist).not.toBeNull()
    const hitman = deals.find((d) => d.title === 'Hitman 2: Silent Assassin')!
    expect(hitman.best).toMatchObject({ storeName: 'GOG', price: 0.89, discountPct: 90 })
  })

  it('searches with each result’s cheapest store', async () => {
    const { store } = service()
    const results = await store.search('hades')
    expect(results).toHaveLength(5)
    expect(results[0]).toMatchObject({
      title: 'Hades',
      steamAppId: '1145360',
      cheapsharkId: '196149'
    })
    expect(results[0]!.best?.storeName).toBe('GOG')
    expect(await store.search('   ')).toEqual([])
  })

  it('builds the purchase sheet: offers, prices in euros, where each one opens', async () => {
    const { store } = service()
    const ref: StoreGameRef = {
      title: 'The Witcher 3: Wild Hunt — Remastered',
      steamAppId: '292030',
      cheapsharkId: null
    }
    const sheet = await store.game(ref)
    expect(sheet.cheapsharkId).toBe('332562')
    expect(sheet.lowestEver).toEqual({ price: 7.09, date: 1577335020000 })
    const gog = sheet.offers.find((o) => o.storeName === 'GOG')!
    expect(gog).toMatchObject({ opensIn: 'browser', gog: { id: '1640424747' } })
    expect(gog.localPrice?.final).toBe('49,99 €')
    const steam = sheet.offers.find((o) => o.storeName === 'Steam')!
    expect(steam.opensIn).toBe('steam')
    expect(parseRemoteImageUrl(sheet.heroUrl!)).toMatch(/library_hero\.jpg/)
  })

  it('still offers Steam when CheapShark does not know the game', async () => {
    const fetch = fakeFetch([
      ['games?steamAppID=', () => json([])],
      ['stores', () => json([])],
      ['GetItems', () => json(apiFixture('steam-store-items.json'))]
    ])
    const { store } = service({}, fetch)
    const sheet = await store.game({ title: 'Hades', steamAppId: '1145360', cheapsharkId: null })
    expect(sheet.offers).toHaveLength(1)
    expect(sheet.offers[0]).toMatchObject({ storeName: 'Steam', price: null, opensIn: 'steam' })
    expect(sheet.offers[0]!.localPrice?.final).toBe('24,50 €')
  })

  it('opens the launcher and follows the purchase', async () => {
    const { store, opened, watched } = service()
    const result = await store.buy({
      title: 'Hades',
      steamAppId: '1145360',
      cheapsharkId: null,
      storeId: '1',
      dealId: null,
      gog: null
    })
    expect(result.opensIn).toBe('steam')
    expect(opened).toEqual(['steam://store/1145360'])
    expect(watched).toEqual([{ title: 'Hades', steamAppId: '1145360', source: 'steam' }])
    await expect(
      store.buy({
        title: 'x',
        steamAppId: null,
        cheapsharkId: null,
        storeId: '25',
        dealId: null,
        gog: null
      })
    ).rejects.toThrow(/lien d’achat/)
  })
})

describe('PurchaseWatcher', () => {
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    let now = 0
    let owned: number | null = null
    const refresh = vi.fn(async () => {})
    const onPurchased = vi.fn()
    const watcher = new PurchaseWatcher({
      refresh,
      findOwned: () => owned,
      onPurchased,
      now: () => now,
      intervalMs: 1000,
      maxAgeMs: 10_000,
      minGapMs: 100
    })
    return {
      watcher,
      refresh,
      onPurchased,
      setOwned: (id: number | null) => (owned = id),
      advance: (ms: number) => (now += ms)
    }
  }
  const hades: PendingPurchase = { title: 'Hades', steamAppId: '1', source: 'steam' }

  it('does not follow a game already in the library', () => {
    const { watcher, setOwned } = setup()
    setOwned(3)
    expect(watcher.add(hades)).toBe(false)
    expect(watcher.pendingCount()).toBe(0)
  })

  it('syncs the store’s launcher on focus and reports the purchase once', async () => {
    const { watcher, refresh, onPurchased, setOwned, advance } = setup()
    watcher.add(hades)
    watcher.add({ title: 'Other', steamAppId: null, source: null })
    advance(200)
    await watcher.check()
    expect(refresh).toHaveBeenCalledWith(['steam', null])
    expect(onPurchased).not.toHaveBeenCalled()

    setOwned(7)
    advance(50)
    watcher.nudge() // too soon after the last check
    expect(refresh).toHaveBeenCalledTimes(1)
    advance(100)
    watcher.nudge()
    await vi.waitFor(() => expect(onPurchased).toHaveBeenCalledTimes(2))
    expect(onPurchased).toHaveBeenCalledWith(hades, 7)
    expect(watcher.pendingCount()).toBe(0)
    watcher.dispose()
  })

  it('forgets purchases never seen and checks in the background', async () => {
    vi.useFakeTimers()
    const { watcher, refresh, advance } = setup()
    watcher.add(hades)
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    advance(20_000)
    await watcher.check()
    expect(watcher.pendingCount()).toBe(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    watcher.dispose()
  })
})
