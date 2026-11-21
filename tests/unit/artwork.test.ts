import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import { MediaCache } from '../../src/main/media/cache'
import {
  fitWithin,
  hasTransparency,
  IMAGE_RULES,
  outputFormat,
  type ImageShrinker
} from '../../src/main/media/shrink-policy'
import { IGDB_SPACING_MS, IgdbClient } from '../../src/main/metadata/igdb'
import {
  ARTWORK_RETRY_MS,
  ENRICH_CONCURRENCY,
  MetadataService
} from '../../src/main/metadata/service'
import { SteamGridDbClient } from '../../src/main/metadata/steamgriddb'
import { SecretStore } from '../../src/main/secrets/store'
import { apiFixture, binary, fakeCipher, fakeFetch, json, MIGRATIONS, tempDir } from './helpers'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SMALL = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

/** Stand-in for Electron's codec: every image becomes the 4 bytes of a JPEG. */
const toSmallJpeg: ImageShrinker = async () => ({ data: SMALL, extension: '.jpg' })

const tick = () => new Promise((resolve) => setTimeout(resolve, 2))

describe('artwork size rules', () => {
  it('fits images in the box of their use, aspect ratio kept', () => {
    // A 1200×1800 SteamGridDB grid → the 600×900 cover box.
    expect(fitWithin(1200, 1800, 'cover')).toEqual({ width: 600, height: 900 })
    // A 3840×1240 hero → full HD width.
    expect(fitWithin(3840, 1240, 'hero')).toEqual({ width: 1920, height: 620 })
    // A very wide logo is limited by its width, a tall one by its height.
    expect(fitWithin(4000, 1000, 'logo')).toEqual({ width: 800, height: 200 })
    expect(fitWithin(1000, 2000, 'logo')).toEqual({ width: 200, height: 400 })
    // Already small enough, or nonsense sizes: left alone.
    expect(fitWithin(600, 900, 'cover')).toBeNull()
    expect(fitWithin(300, 450, 'cover')).toBeNull()
    expect(fitWithin(0, 0, 'hero')).toBeNull()
  })

  it('keeps PNG for logos and transparent images, JPEG otherwise', () => {
    expect(outputFormat('logo', false)).toBe('png')
    expect(outputFormat('cover', true)).toBe('png')
    expect(outputFormat('cover', false)).toBe('jpeg')
    expect(outputFormat('hero', false)).toBe('jpeg')
    expect(hasTransparency(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false)
    expect(hasTransparency(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]))).toBe(true)
  })
})

describe('media cache sizes', () => {
  const images = () => fakeFetch([['cdn2.steamgriddb.com', () => binary(PNG, 'image/png')]])

  it('stores artwork at its display size when a kind is given', async () => {
    const dir = tempDir()
    const kinds: string[] = []
    const cache = new MediaCache(dir, images(), async (data, kind) => {
      kinds.push(kind)
      return toSmallJpeg(data, kind)
    })
    const cover = await cache.download(
      'https://cdn2.steamgriddb.com/grid/a.png',
      '1-cover',
      'cover'
    )
    expect(cover).toMatch(/^1-cover-\w+\.jpg$/)
    expect(readFileSync(join(dir, cover))).toEqual(Buffer.from(SMALL))
    // No kind (match thumbnails, custom files): as downloaded.
    const raw = await cache.download('https://cdn2.steamgriddb.com/grid/a.png', '1-x')
    expect(raw).toMatch(/\.png$/)
    expect(kinds).toEqual(['cover'])
  })

  it('keeps the downloaded bytes when the image cannot be shrunk', async () => {
    const dir = tempDir()
    const keep = new MediaCache(dir, images(), async () => null)
    const failing = new MediaCache(dir, images(), async () => {
      throw new Error('decoder crashed')
    })
    for (const cache of [keep, failing]) {
      const name = await cache.download('https://cdn2.steamgriddb.com/h.png', '2-hero', 'hero')
      expect(name).toMatch(/\.png$/)
      expect(readFileSync(join(dir, name))).toEqual(Buffer.from(PNG))
    }
  })

  it('compacts only files over the size of their kind, replacing them', async () => {
    const dir = tempDir()
    const cache = new MediaCache(dir, undefined, toSmallJpeg)
    writeFileSync(join(dir, '1-hero-big.png'), Buffer.alloc(IMAGE_RULES.hero.compactAbove + 1))
    writeFileSync(join(dir, '1-cover-small.jpg'), Buffer.alloc(1000))

    const next = await cache.compact('1-hero-big.png', 'hero', '1-hero')
    expect(next).toMatch(/^1-hero-\w+\.jpg$/)
    expect(existsSync(join(dir, '1-hero-big.png'))).toBe(false)
    expect(readFileSync(join(dir, next!))).toEqual(Buffer.from(SMALL))

    expect(await cache.compact('1-cover-small.jpg', 'cover', '1-cover')).toBeNull()
    expect(await cache.compact('missing.png', 'cover', '1-cover')).toBeNull()
    expect(await cache.compact('../secrets.json', 'cover', '1-cover')).toBeNull()
    // Without a codec (unit tests, other tools): nothing to do.
    expect(await new MediaCache(dir).compact(next!, 'hero', '1-hero')).toBeNull()
  })
})

describe('SteamGridDB requests', () => {
  const routes = () =>
    fakeFetch([
      ['/search/autocomplete/', () => json(apiFixture('sgdb-search.json'))],
      ['/grids/', () => json(apiFixture('sgdb-grids.json'))],
      ['/heroes/', () => json(apiFixture('sgdb-heroes.json'))],
      ['/logos/', () => json(apiFixture('sgdb-logos.json'))]
    ])

  it('asks only for the requested kinds, searches each title once', async () => {
    const fetch = routes()
    const ids = new Map<string, number>()
    const first = new SteamGridDbClient('key', fetch, ids)
    expect(await first.artwork({ title: 'Hollow Knight' }, ['grids'])).toEqual({
      cover: 'https://cdn2.steamgriddb.com/grid/cover.png',
      hero: null,
      logo: null
    })
    expect(fetch.calls.map((c) => new URL(c.url).pathname.split('/')[3])).toEqual([
      'search',
      'grids'
    ])

    fetch.calls.length = 0
    await new SteamGridDbClient('key', fetch, ids).artwork({ title: 'Hollow Knight' }, [
      'heroes',
      'logos'
    ])
    expect(fetch.calls.some((c) => c.url.includes('/search/'))).toBe(false)
    expect(fetch.calls).toHaveLength(2)
  })
})

describe('IGDB under parallel enrichment', () => {
  it('shares one token and spaces requests to stay under 4 per second', async () => {
    let clock = 1_000_000
    const waits: number[] = []
    const fetch = fakeFetch([
      ['id.twitch.tv', async () => (await tick(), json(apiFixture('twitch-token.json')))],
      ['api.igdb.com', () => json(apiFixture('igdb-search.json'))]
    ])
    const client = new IgdbClient(
      'c',
      's',
      fetch,
      () => clock,
      async (ms) => {
        waits.push(ms)
      }
    )
    await Promise.all([client.search('a'), client.search('b'), client.search('c')])
    expect(fetch.calls.filter((c) => c.url.includes('twitch'))).toHaveLength(1)
    expect(waits).toEqual([IGDB_SPACING_MS, 2 * IGDB_SPACING_MS])

    // Later requests, once the spacing has passed, go out at once.
    clock += 10_000
    await client.search('d')
    expect(waits).toHaveLength(2)
  })
})

describe('background enrichment', () => {
  let handle: DatabaseHandle
  let secrets: SecretStore
  let dir: string
  let clock: number
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    secrets = new SecretStore(join(tempDir(), 'secrets.json'), fakeCipher)
    dir = join(tempDir(), 'covers')
    clock = Date.UTC(2026, 10, 21)
  })
  afterEach(() => handle.close())

  const insert = (title: string) =>
    handle.db.insert(games).values({ title, source: 'epic', sourceId: title }).returning().get()
  const row = (id: number) => handle.db.select().from(games).where(eq(games.id, id)).get()!

  /**
   * SteamGridDB with network latency. Records how many API requests run at once and the
   * order of the kinds asked for. Titles starting with "Unknown" have no SteamGridDB entry.
   */
  function sgdbNetwork(options: { down?: boolean } = {}) {
    const log: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const api = (kind: string, body: () => unknown) => async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      log.push(kind)
      await tick()
      inFlight--
      return options.down ? json({}, 503) : json(body())
    }
    const fetch = fakeFetch([
      ['/search/autocomplete/Unknown', api('search', () => ({ success: true, data: [] }))],
      ['/search/autocomplete/', api('search', () => apiFixture('sgdb-search.json'))],
      ['/grids/', api('grids', () => apiFixture('sgdb-grids.json'))],
      ['/heroes/', api('heroes', () => apiFixture('sgdb-heroes.json'))],
      ['/logos/', api('logos', () => apiFixture('sgdb-logos.json'))],
      ['cdn2.steamgriddb.com', () => binary(PNG, 'image/png')]
    ])
    return { fetch, log, maxInFlight: () => maxInFlight }
  }

  const service = (fetch: ReturnType<typeof fakeFetch>) => {
    const s = new MetadataService(
      handle.db,
      secrets,
      new MediaCache(dir, fetch, toSmallJpeg),
      fetch,
      () => clock
    )
    s.setKeys({ steamGridDbKey: 'k' })
    return s
  }

  it('enriches several games at once, every cover before heroes and logos', async () => {
    const network = sgdbNetwork()
    const s = service(network.fetch)
    const ids = Array.from({ length: 10 }, (_, i) => insert(`Game ${i}`).id)

    let progress = 0
    expect(await s.enrichMissing(() => progress++)).toBe(10)
    // Two progress events per game: cover, then the rest.
    expect(progress).toBe(20)
    expect(network.maxInFlight()).toBeGreaterThan(1)
    // At most ENRICH_CONCURRENCY games, each asking for its hero and logo together.
    expect(network.maxInFlight()).toBeLessThanOrEqual(2 * ENRICH_CONCURRENCY)

    // Covers first: no hero or logo asked for before the last grid.
    const lastGrid = network.log.lastIndexOf('grids')
    const firstExtra = network.log.findIndex((k) => k === 'heroes' || k === 'logos')
    expect(lastGrid).toBeLessThan(firstExtra)
    // One title search per game, reused by the second pass.
    expect(network.log.filter((k) => k === 'search')).toHaveLength(10)

    for (const id of ids) {
      expect(row(id).coverPath).toMatch(/\.jpg$/) // shrunk
      expect(row(id).heroPath).toMatch(/\.jpg$/)
      expect(row(id).artworkCheckedAt?.getTime()).toBe(clock)
    }
    expect(readdirSync(dir)).toHaveLength(20) // cover + hero (no logo in the fixture)
  })

  it('remembers games without artwork, looks them up again a week later', async () => {
    const network = sgdbNetwork()
    const s = service(network.fetch)
    const unknown = insert('Unknown Game')

    expect(await s.enrichMissing()).toBe(1)
    expect(row(unknown.id)).toMatchObject({ coverPath: null })
    expect(row(unknown.id).artworkCheckedAt?.getTime()).toBe(clock)

    // Next startups: not looked up again…
    network.log.length = 0
    clock += ARTWORK_RETRY_MS - 1
    await s.enrichMissing()
    expect(network.log).toEqual([])

    // …until a week has passed.
    clock += 2
    await s.enrichMissing()
    expect(network.log).toEqual(['search'])

    // New keys: everything without artwork is worth a new lookup.
    network.log.length = 0
    s.setKeys({ steamGridDbKey: 'new-key' })
    expect(row(unknown.id).artworkCheckedAt).toBeNull()
    await s.enrichMissing()
    expect(network.log).toEqual(['search'])
  })

  it('does not remember a lookup that failed on the network', async () => {
    const s = service(sgdbNetwork({ down: true }).fetch)
    const game = insert('Hollow Knight')
    await s.enrichMissing()
    expect(row(game.id)).toMatchObject({ coverPath: null, artworkCheckedAt: null })
  })

  it('looks up every missing game, beyond the former batch of 100', async () => {
    const network = sgdbNetwork()
    const s = service(network.fetch)
    for (let i = 0; i < 130; i++) insert(`Game ${i}`)
    expect(await s.enrichMissing()).toBe(130)
    expect(
      handle.db
        .select()
        .from(games)
        .all()
        .every((g) => g.coverPath)
    ).toBe(true)
  })

  it('IGDB: reuses the search result instead of querying the game again', async () => {
    const fetch = fakeFetch([
      ['id.twitch.tv', () => json(apiFixture('twitch-token.json'))],
      ['api.igdb.com', () => json(apiFixture('igdb-search.json'))],
      ['images.igdb.com', () => binary(PNG, 'image/jpeg')]
    ])
    const s = new MetadataService(
      handle.db,
      secrets,
      new MediaCache(dir, fetch),
      fetch,
      () => clock
    )
    s.setKeys({ igdbClientId: 'c', igdbClientSecret: 's' })
    const hades = insert('Hades')
    const unknown = insert('Totally Unknown')
    await s.enrichMissing()
    expect(fetch.calls.filter((c) => c.url.includes('api.igdb.com'))).toHaveLength(2)
    expect(row(hades.id)).toMatchObject({ igdbId: 113112 })
    expect(row(hades.id).coverPath).toBeTruthy()
    // IGDB only, no exact match: remembered too.
    expect(row(unknown.id).artworkCheckedAt?.getTime()).toBe(clock)
  })

  it('compacts artwork downloaded at full size by older versions', async () => {
    const s = service(sgdbNetwork().fetch)
    const game = insert('Old')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${game.id}-cover-old.png`), Buffer.alloc(3_000_000))
    writeFileSync(join(dir, `${game.id}-hero-old.png`), Buffer.alloc(5_000_000))
    writeFileSync(join(dir, `${game.id}-logo-ok.png`), Buffer.alloc(10_000))
    writeFileSync(join(dir, `${game.id}-shot-old.jpg`), Buffer.alloc(900_000))
    handle.db
      .update(games)
      .set({
        coverPath: `${game.id}-cover-old.png`,
        heroPath: `${game.id}-hero-old.png`,
        logoPath: `${game.id}-logo-ok.png`,
        screenshots: [`${game.id}-shot-old.jpg`]
      })
      .where(eq(games.id, game.id))
      .run()

    let progress = 0
    expect(await s.compactCache(() => progress++)).toBe(3)
    expect(progress).toBe(1)
    const after = row(game.id)
    expect(after.coverPath).toMatch(new RegExp(`^${game.id}-cover-\\w+\\.jpg$`))
    expect(after.heroPath).toMatch(/\.jpg$/)
    expect(after.logoPath).toBe(`${game.id}-logo-ok.png`)
    expect(after.screenshots?.[0]).not.toBe(`${game.id}-shot-old.jpg`)
    expect(readdirSync(dir).sort()).toEqual(
      [after.coverPath, after.heroPath, after.logoPath, after.screenshots![0]].sort()
    )
    // Already compact: nothing more to do at the next startup.
    expect(await s.compactCache()).toBe(0)
  })
})
