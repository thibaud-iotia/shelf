import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import { MediaCache, resolveMediaPath } from '../../src/main/media/cache'
import {
  apicalypseString,
  IgdbClient,
  toMetadata,
  type IgdbGame
} from '../../src/main/metadata/igdb'
import { MetadataService, SECRET_REFS } from '../../src/main/metadata/service'
import { SteamGridDbClient } from '../../src/main/metadata/steamgriddb'
import { SecretStore } from '../../src/main/secrets/store'
import { apiFixture, binary, fakeCipher, fakeFetch, json, MIGRATIONS, tempDir } from './helpers'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const recorded = () =>
  fakeFetch([
    ['id.twitch.tv/oauth2/token', () => json(apiFixture('twitch-token.json'))],
    ['api.igdb.com/v4/games', () => json(apiFixture('igdb-search.json'))],
    ['/search/autocomplete/', () => json(apiFixture('sgdb-search.json'))],
    ['/grids/', () => json(apiFixture('sgdb-grids.json'))],
    ['/heroes/', () => json(apiFixture('sgdb-heroes.json'))],
    ['/logos/', () => json(apiFixture('sgdb-logos.json'))],
    ['images.igdb.com', () => binary(PNG, 'image/jpeg')],
    ['cdn2.steamgriddb.com', () => binary(PNG, 'image/png')]
  ])

describe('IGDB', () => {
  it('maps a game to Shelf metadata', () => {
    const [hades] = apiFixture('igdb-search.json') as IgdbGame[]
    expect(toMetadata(hades!)).toEqual({
      igdbId: 113112,
      title: 'Hades',
      description: 'Defy the god of the dead as you hack and slash out of the Underworld.',
      releaseDate: '2020-09-17',
      year: 2020,
      genres: ['Role-playing (RPG)', 'Adventure'],
      developer: 'Supergiant Games',
      coverImageId: 'co39vc',
      heroImageId: 'ar5xyz',
      screenshotIds: ['sc8a1', 'sc8a2']
    })
  })

  it('escapes search strings', () => {
    expect(apicalypseString('Say "Hi" \\o/')).toBe('"Say \\"Hi\\" \\\\o/"')
  })

  it('authenticates once with Twitch and queries with the token', async () => {
    const fetch = recorded()
    const client = new IgdbClient('client', 'secret', fetch)
    await client.search('Hades')
    await client.byId(113112)
    const tokenCalls = fetch.calls.filter((c) => c.url.includes('twitch'))
    expect(tokenCalls).toHaveLength(1)
    const query = fetch.calls.find((c) => c.url.includes('igdb.com'))!
    expect(new Headers(query.init?.headers).get('client-id')).toBe('client')
    expect(new Headers(query.init?.headers).get('authorization')).toBe('Bearer twitch-token')
    expect(String(query.init?.body)).toContain('search "Hades";')
  })

  it('reports refused credentials', async () => {
    const client = new IgdbClient(
      'x',
      'y',
      fakeFetch([['twitch', () => json({ message: 'invalid client' }, 400)]])
    )
    await expect(client.test()).rejects.toThrow('Client ID ou secret IGDB (Twitch) refusé.')
  })
})

describe('SteamGridDB', () => {
  it('uses the Steam app id when known, a title search otherwise', async () => {
    const fetch = recorded()
    const client = new SteamGridDbClient('key', fetch)
    expect(await client.artwork({ steamAppId: '367520' })).toEqual({
      cover: 'https://cdn2.steamgriddb.com/grid/cover.png',
      hero: 'https://cdn2.steamgriddb.com/hero/hero.png',
      logo: null
    })
    expect(fetch.calls.some((c) => c.url.includes('/grids/steam/367520?dimensions=600x900'))).toBe(
      true
    )

    fetch.calls.length = 0
    await client.artwork({ title: 'Hollow Knight' })
    expect(fetch.calls[0]?.url).toContain('/search/autocomplete/Hollow%20Knight')
    expect(fetch.calls.some((c) => c.url.includes('/grids/game/5248150'))).toBe(true)
  })

  it('treats 404 as "no artwork" and 401 as a bad key', async () => {
    const missing = new SteamGridDbClient(
      'key',
      fakeFetch([['', () => json({ success: false }, 404)]])
    )
    expect(await missing.artwork({ steamAppId: '1' })).toEqual({
      cover: null,
      hero: null,
      logo: null
    })
    const refused = new SteamGridDbClient('key', fakeFetch([['', () => json({}, 401)]]))
    await expect(refused.test()).rejects.toThrow('Clé API SteamGridDB refusée.')
  })
})

describe('media cache and protocol paths', () => {
  it('downloads with the right extension and reports its size', async () => {
    const dir = join(tempDir(), 'covers')
    const cache = new MediaCache(dir, recorded())
    const name = await cache.download('https://cdn2.steamgriddb.com/grid/cover.png', '7-cover')
    expect(name).toMatch(/^7-cover-\w+\.png$/)
    expect(cache.info()).toEqual({ bytes: PNG.length, files: 1 })
    expect(await cache.downloadOnce('https://images.igdb.com/x.jpg', 'igdb-thumb-x.jpg')).toBe(
      'igdb-thumb-x.jpg'
    )
    cache.remove([name, '../escape'])
    expect(cache.info().files).toBe(1)
    cache.clear()
    expect(cache.info()).toEqual({ bytes: 0, files: 0 })
  })

  it('refuses downloads outside the allow-list', async () => {
    const cache = new MediaCache(tempDir(), recorded())
    await expect(cache.download('https://example.com/a.png', 'x')).rejects.toThrow(/refusé/)
  })

  it('resolves only plain file names of the covers host', () => {
    const dir = tempDir()
    writeFileSync(join(dir, '1-cover-a.png'), PNG)
    expect(resolveMediaPath(dir, 'shelf-media://covers/1-cover-a.png')).toBe(
      join(dir, '1-cover-a.png')
    )
    expect(resolveMediaPath(dir, 'shelf-media://covers/..%2F..%2Fsecrets.json')).toBeNull()
    expect(resolveMediaPath(dir, 'shelf-media://covers/%2e%2e')).toBeNull()
    expect(resolveMediaPath(dir, 'shelf-media://other/1-cover-a.png')).toBeNull()
    expect(resolveMediaPath(dir, 'shelf-media://covers/missing.png')).toBeNull()
  })
})

describe('MetadataService', () => {
  let handle: DatabaseHandle
  let secrets: SecretStore
  let dir: string
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    secrets = new SecretStore(join(tempDir(), 'secrets.json'), fakeCipher)
    dir = join(tempDir(), 'covers')
  })
  afterEach(() => handle.close())

  const service = (fetch = recorded()) =>
    new MetadataService(handle.db, secrets, new MediaCache(dir, fetch), fetch)
  const insert = (title: string, source: 'steam' | 'manual' = 'manual', sourceId = title) =>
    handle.db.insert(games).values({ title, source, sourceId }).returning().get()

  it('needs keys, stores them encrypted, tests them', async () => {
    const s = service()
    expect(s.igdbConfigured()).toBe(false)
    await expect(s.search('Hades')).rejects.toThrow(/Configurez IGDB/)
    s.setKeys({ igdbClientId: 'client', igdbClientSecret: 'secret', steamGridDbKey: '  ' })
    expect(s.igdbConfigured()).toBe(true)
    expect(s.steamGridDbConfigured()).toBe(false) // blank = unchanged
    expect(await s.test('igdb')).toEqual({ ok: true, message: '✓ connecté' })
    expect(await s.test('steamgriddb')).toEqual({ ok: false, message: 'Clé API manquante.' })
    s.clearKeys('igdb')
    expect(secrets.has(SECRET_REFS.igdbClientId)).toBe(false)
  })

  it('searches with cached thumbnails', async () => {
    const s = service()
    s.setKeys({ igdbClientId: 'c', igdbClientSecret: 's' })
    const matches = await s.search('Hades')
    expect(matches[0]).toMatchObject({
      igdbId: 113112,
      name: 'Hades',
      year: 2020,
      developer: 'Supergiant Games'
    })
    expect(matches[0]?.thumbUrl).toBe('shelf-media://covers/igdb-thumb-co39vc.jpg')
    expect(matches[1]?.thumbUrl).toBeNull()
  })

  it('applies metadata and artwork, replacing old files', async () => {
    const s = service()
    s.setKeys({ igdbClientId: 'c', igdbClientSecret: 's', steamGridDbKey: 'k' })
    const game = insert('Hades', 'steam', '1145360')
    await s.apply(game.id, 113112)
    let row = handle.db.select().from(games).where(eq(games.id, game.id)).get()!
    expect(row).toMatchObject({
      igdbId: 113112,
      developer: 'Supergiant Games',
      releaseDate: '2020-09-17',
      genres: ['Role-playing (RPG)', 'Adventure']
    })
    expect(row.coverPath).toMatch(/\.png$/) // SteamGridDB grid wins over the IGDB cover
    expect(row.screenshots).toHaveLength(2)
    const firstCover = row.coverPath!

    await s.refreshArtwork(game.id)
    row = handle.db.select().from(games).where(eq(games.id, game.id)).get()!
    expect(row.coverPath).not.toBe(firstCover)
    expect(existsSync(join(dir, firstCover))).toBe(false)
    expect(readdirSync(dir).filter((f) => f.startsWith(`${game.id}-`))).toHaveLength(4)

    s.clearCache()
    expect(handle.db.select().from(games).where(eq(games.id, game.id)).get()?.coverPath).toBeNull()
  })

  it('enriches automatically only on an exact title match', async () => {
    const s = service()
    s.setKeys({ igdbClientId: 'c', igdbClientSecret: 's' })
    const hades = insert('Hades')
    const other = insert('Totally Unknown')
    const skipped = insert('Celeste')
    expect(
      await s.enrich([{ id: hades.id }, { id: other.id }, { id: skipped.id, igdbId: null }])
    ).toBe(1)
    const rows = handle.db.select().from(games).all()
    expect(rows.find((r) => r.id === hades.id)?.igdbId).toBe(113112)
    expect(rows.find((r) => r.id === other.id)?.igdbId).toBeNull()
    expect(rows.find((r) => r.id === skipped.id)?.coverPath).toBeNull()
  })

  it('sets a custom cover from a local file', () => {
    const s = service()
    const game = insert('Doom')
    const file = join(tempDir(), 'my-cover.png')
    writeFileSync(file, PNG)
    s.setCustomCover(game.id, file)
    expect(handle.db.select().from(games).where(eq(games.id, game.id)).get()?.coverPath).toMatch(
      new RegExp(`^${game.id}-cover-.*\\.png$`)
    )
    expect(() => s.setCustomCover(game.id, join(tempDir(), 'notes.txt'))).toThrow(/image/)
  })
})
