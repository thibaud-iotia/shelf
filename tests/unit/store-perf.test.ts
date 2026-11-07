import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import type { FetchLike } from '../../src/main/net/http'
import { limiter, TtlCache } from '../../src/main/store/cache'
import { PREWARM_DELAY_MS, prewarmDelay, StoreService } from '../../src/main/store/service'
import { MIGRATIONS } from './helpers'

// Performance of the store's first display. The network is simulated with a fixed latency
// per request on a virtual clock (fake timers): elapsed time = number of round trips on the
// critical path × LATENCY, whatever the machine. Before the optimisation the first visit
// cost 4 round trips for the deals and 17 for a 120-game wishlist.

const LATENCY = 100
const DEALS = 60
const PARALLEL = 4

interface Network {
  fetch: FetchLike
  calls: string[]
  /** Highest number of requests in flight at once, per host. */
  peak: Map<string, number>
  /** Appids asked to Steam's GetItems, in order. */
  steamItemIds: string[]
}

const respond = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })

/** Synthetic CheapShark + Steam: 60 deals (appids 1000…), a wishlist of appids from 1030. */
function network(wishlistSize: number, latency = LATENCY): Network {
  const calls: string[] = []
  const peak = new Map<string, number>()
  const inFlight = new Map<string, number>()
  const steamItemIds: string[] = []

  const answer = (url: URL): unknown => {
    if (url.pathname.endsWith('/stores')) {
      return [
        { storeID: '1', storeName: 'Steam', isActive: 1 },
        { storeID: '7', storeName: 'GOG', isActive: 1 },
        { storeID: '25', storeName: 'Epic Games Store', isActive: 1 }
      ]
    }
    if (url.pathname.endsWith('/deals')) {
      const appIds = url.searchParams.get('steamAppID')?.split(',')
      const deal = (appId: string, i: number) => ({
        title: `Jeu ${appId}`,
        dealID: `deal-${appId}`,
        storeID: '1',
        gameID: String(5000 + i),
        salePrice: '4.99',
        normalPrice: '19.99',
        savings: '75',
        steamRatingText: 'Very Positive',
        steamRatingPercent: '90',
        steamAppID: appId
      })
      if (appIds) return appIds.map((id) => deal(id, Number(id)))
      return Array.from({ length: DEALS }, (_, i) => deal(String(1000 + i), i))
    }
    if (url.pathname.endsWith('/GetWishlist/v1/')) {
      return {
        response: {
          items: Array.from({ length: wishlistSize }, (_, i) => ({
            appid: 1030 + i,
            priority: i + 1,
            date_added: 1_700_000_000
          }))
        }
      }
    }
    if (url.pathname.endsWith('/GetItems/v1/')) {
      const input = JSON.parse(url.searchParams.get('input_json')!) as {
        ids: { appid: number }[]
      }
      steamItemIds.push(...input.ids.map((i) => String(i.appid)))
      return {
        response: {
          store_items: input.ids.map(({ appid }) => ({
            appid,
            success: 1,
            name: `Jeu ${appid}`,
            assets: { asset_url_format: `steam/apps/${appid}/\${FILENAME}`, header: 'header.jpg' },
            best_purchase_option: { formatted_final_price: '9,99€', discount_pct: 0 }
          }))
        }
      }
    }
    throw new Error(`Unexpected request in test: ${url}`)
  }

  const fetch: FetchLike = async (raw) => {
    const url = new URL(raw)
    calls.push(raw)
    const host = url.hostname
    inFlight.set(host, (inFlight.get(host) ?? 0) + 1)
    peak.set(host, Math.max(peak.get(host) ?? 0, inFlight.get(host)!))
    await new Promise((resolve) => setTimeout(resolve, latency))
    inFlight.set(host, inFlight.get(host)! - 1)
    return respond(answer(url))
  }
  return { fetch, calls, peak, steamItemIds }
}

/** Runs `task` on the virtual clock; returns its value and the virtual time it took. */
async function timed<T>(task: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now()
  let done = false
  const promise = task().finally(() => {
    done = true
  })
  for (let turn = 0; !done && turn < 10_000; turn++) {
    // Real I/O (response bodies) runs on real ticks; only the latency timers are virtual.
    await new Promise((resolve) => setImmediate(resolve))
    if (vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync()
  }
  const value = await promise
  return { value, ms: Date.now() - start }
}

const rounds = (ms: number) => ms / LATENCY

describe('store first display (virtual network, 100 ms per request)', () => {
  let handle: DatabaseHandle
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    handle.close()
  })

  const service = (net: Network, steamId: string | null = '76561198000000000') =>
    new StoreService({
      db: handle.db,
      steamId: () => steamId,
      launcherAvailable: async () => false,
      openExternal: async () => undefined,
      watchPurchase: () => undefined,
      userAgent: 'Shelf/test',
      fetch: net.fetch
    })

  it('cold deals: 2 round trips (store names and deals together, then Steam prices)', async () => {
    const net = network(0)
    const { value, ms } = await timed(() => service(net).deals())
    expect(value).toHaveLength(DEALS)
    expect(value[0]!.steamPrice?.final).toBe('9,99 €')
    expect(rounds(ms)).toBeLessThanOrEqual(2)
  })

  it('cold 120-game wishlist: 4 round trips instead of 17', async () => {
    const net = network(120)
    const { value, ms } = await timed(() => service(net).wishlist())
    expect(value.items).toHaveLength(120)
    expect(value.items.every((g) => g.best?.price === 4.99)).toBe(true)
    expect(value.pricesError).toBeNull()
    // GetWishlist, then Steam prices (3 calls at once) while CheapShark's 12 calls go 4 by 4.
    expect(rounds(ms)).toBeLessThanOrEqual(1 + Math.ceil(12 / PARALLEL))
  })

  it('cold home (deals + wishlist at once): bounded by the slowest, not the sum', async () => {
    const net = network(120)
    const store = service(net)
    const { ms } = await timed(() => Promise.all([store.deals(), store.wishlist()]))
    expect(rounds(ms)).toBeLessThanOrEqual(5)
  })

  it('never sends more than 4 requests at once to a service', async () => {
    const net = network(300)
    await timed(() => service(net).wishlist())
    expect(net.peak.get('www.cheapshark.com')).toBeLessThanOrEqual(PARALLEL)
    expect(net.peak.get('api.steampowered.com')).toBeLessThanOrEqual(PARALLEL)
  })

  it('after the warm-up, the home is served without any request', async () => {
    const net = network(120)
    const store = service(net)
    const images: string[] = []
    await timed(() =>
      store.prewarm(async (url) => {
        images.push(url)
      })
    )
    // First cards of the home (deals not owned, then the wishlist row) are downloaded.
    expect(images.length).toBeGreaterThan(10)
    expect(images.every((url) => url.startsWith('https://'))).toBe(true)

    const before = net.calls.length
    const { ms } = await timed(() => Promise.all([store.deals(), store.wishlist()]))
    expect(ms).toBe(0)
    expect(net.calls.length).toBe(before)
  })

  it('a visit during the warm-up waits for it instead of asking again', async () => {
    const net = network(120)
    const store = service(net)
    const warm = store.prewarm()
    await vi.advanceTimersByTimeAsync(LATENCY / 2)
    const { ms } = await timed(() => Promise.all([store.deals(), store.wishlist(), warm]))
    expect(rounds(ms)).toBeLessThanOrEqual(5)
    const count = (part: string) => net.calls.filter((url) => url.includes(part)).length
    expect(count('/deals?storeID')).toBe(1)
    expect(count('/stores')).toBe(1)
    expect(count('GetWishlist')).toBe(1)
  })

  it('shares Steam prices per appid between the deals and the wishlist', async () => {
    const net = network(120)
    const store = service(net)
    await timed(() => store.deals())
    await timed(() => store.wishlist())
    // Deals: 1000–1059; wishlist: 1030–1149 (30 in common, asked once).
    expect(net.steamItemIds).toHaveLength(new Set(net.steamItemIds).size)
    expect(net.steamItemIds).toHaveLength(150)
  })
})

describe('store CPU budget (warm caches, real time)', () => {
  let handle: DatabaseHandle
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
  })
  afterEach(() => handle.close())

  it('decorates a 1000-game wishlist and the deals in well under a frame budget', async () => {
    const net = network(1000, 0)
    const store = new StoreService({
      db: handle.db,
      steamId: () => '76561198000000000',
      launcherAvailable: async () => false,
      openExternal: async () => undefined,
      watchPurchase: () => undefined,
      userAgent: 'Shelf/test',
      fetch: net.fetch
    })
    await store.prewarm()
    const start = performance.now()
    const [deals, wishlist] = await Promise.all([store.deals(), store.wishlist()])
    const ms = performance.now() - start
    expect(deals).toHaveLength(DEALS)
    expect(wishlist.items).toHaveLength(1000)
    expect(ms).toBeLessThan(150)
  })
})

describe('cache building blocks', () => {
  it('limiter runs at most n tasks at once, in call order', async () => {
    const limit = limiter(2)
    let active = 0
    let peak = 0
    const order: number[] = []
    const task = (i: number) =>
      limit(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(i)
        active--
        return i
      })
    expect(await Promise.all([0, 1, 2, 3, 4].map(task))).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect(order).toEqual([0, 1, 2, 3, 4])
  })

  it('TtlCache.many asks only unknown ids, caches absent ones, forgets failures', async () => {
    let now = 0
    const cache = new TtlCache(1000, () => now)
    const asked: string[][] = []
    let fail = false
    const load = async (part: string[]) => {
      asked.push(part)
      if (fail) throw new Error('offline')
      return new Map(part.filter((id) => id !== 'x').map((id) => [id, id.toUpperCase()]))
    }
    expect([...(await cache.many('k', ['b', 'a', 'x'], 2, load))]).toEqual([
      ['b', 'B'],
      ['a', 'A']
    ])
    expect(asked).toEqual([['a', 'b'], ['x']])
    // Known (and known absent) ids are not asked again; a new one is.
    expect((await cache.many('k', ['a', 'x', 'c'], 2, load)).get('c')).toBe('C')
    expect(asked.at(-1)).toEqual(['c'])
    // Failures are not kept, expired entries are asked again.
    fail = true
    await expect(cache.many('k', ['d'], 2, load)).rejects.toThrow('offline')
    fail = false
    expect((await cache.many('k', ['d'], 2, load)).get('d')).toBe('D')
    now = 2000
    await cache.many('k', ['a'], 2, load)
    expect(asked.at(-1)).toEqual(['a'])
  })

  it('reads the warm-up delay from the environment', () => {
    expect(prewarmDelay(undefined)).toBe(PREWARM_DELAY_MS)
    expect(prewarmDelay('off')).toBeNull()
    expect(prewarmDelay('250')).toBe(250)
    expect(prewarmDelay('soon')).toBe(PREWARM_DELAY_MS)
  })
})
