import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import { createManualGame, getGame } from '../../src/main/games/repository'
import { steamAppId, validateGamePatch } from '../../src/main/games/validation'
import { buildLinks, linkKind, youtubeVideos } from '../../src/main/insights/links'
import {
  InsightsService,
  NO_STEAM_ACCOUNT,
  NO_STEAM_PAGE,
  type InsightsDeps
} from '../../src/main/insights/service'
import {
  htmlText,
  matchStoreSearch,
  mergeAchievements,
  newsImage,
  newsSummary,
  parseAppDetails,
  parseCommunity,
  parseNews,
  steamHeaderUrl,
  parsePlayers,
  parseLanguages,
  parseRequirements,
  parseReviews,
  storeAbout,
  storeInfo,
  steamVideos,
  type AppDetailsResponse,
  type GlobalPercentagesResponse,
  type NewsResponse,
  type PlayerAchievementsResponse,
  type QueryFilesResponse,
  type SchemaResponse,
  type StoreBrowseResponse,
  type StoreSearchResponse
} from '../../src/main/insights/steam-store'
import { parseRemoteImageUrl, RemoteImageCache, remoteImageUrl } from '../../src/main/media/remote'
import { IgdbClient } from '../../src/main/metadata/igdb'
import { assertAllowed } from '../../src/main/net/http'
import { apiFixture, binary, fakeFetch, json, MIGRATIONS } from './helpers'

/** Original URL behind a proxied image URL. */
const proxied = (media: string) => parseRemoteImageUrl(media)

describe('remote images', () => {
  it('proxies allowed CDNs through shelf-media://remote and decodes them back', () => {
    const url = 'https://shared.akamai.steamstatic.com/store_item_assets/a b.jpg?t=1'
    const media = remoteImageUrl(url)
    expect(media).toMatch(/^shelf-media:\/\/remote\/[\w-]+$/)
    expect(parseRemoteImageUrl(media!)).toBe(new URL(url).toString())
  })

  it('refuses other hosts, plain http and forged tokens', () => {
    expect(remoteImageUrl('https://evil.example.com/x.png')).toBeNull()
    expect(remoteImageUrl('http://shared.akamai.steamstatic.com/x.png')).toBeNull()
    expect(remoteImageUrl(null)).toBeNull()
    const forged = Buffer.from('https://evil.example.com/x.png').toString('base64url')
    expect(parseRemoteImageUrl(`shelf-media://remote/${forged}`)).toBeNull()
    expect(parseRemoteImageUrl('shelf-media://remote/..%2F..')).toBeNull()
    expect(parseRemoteImageUrl('shelf-media://covers/x.png')).toBeNull()
  })

  it('caches downloads, shares concurrent requests and evicts the oldest', async () => {
    const fetch = fakeFetch([
      ['/big', () => binary(new Uint8Array(60), 'image/jpeg')],
      ['/text', () => new Response('hi', { headers: { 'content-type': 'text/html' } })],
      ['steamstatic.com', () => binary(new Uint8Array(40), 'image/png')]
    ])
    const cache = new RemoteImageCache(fetch, 90)
    const a = 'https://cdn.akamai.steamstatic.com/a.png'
    const [first, second] = await Promise.all([cache.get(a), cache.get(a)])
    expect(first).toBe(second)
    expect(first.contentType).toBe('image/png')
    await cache.get(a)
    expect(fetch.calls).toHaveLength(1)

    await cache.get('https://cdn.akamai.steamstatic.com/big')
    expect(cache.size).toEqual({ entries: 1, bytes: 60 })
    await cache.get(a)
    expect(fetch.calls).toHaveLength(3)

    await expect(cache.get('https://cdn.akamai.steamstatic.com/text')).rejects.toThrow(/image/)
  })

  it('allows the Steam store host for the API', () => {
    expect(assertAllowed('https://store.steampowered.com/api/appdetails').hostname).toBe(
      'store.steampowered.com'
    )
  })
})

describe('Steam store parsers', () => {
  it('matches the store search on the exact normalized title only', () => {
    const data = apiFixture('steam-storesearch.json') as StoreSearchResponse
    expect(matchStoreSearch(data, 'PORTAL 2™')).toBe('620')
    expect(matchStoreSearch(data, 'Portal 2 Soundtrack')).toBe('323180')
    expect(matchStoreSearch(data, 'Portal')).toBeNull()
    expect(matchStoreSearch({}, 'Portal 2')).toBeNull()
  })

  it('reads the store page details of the overview', () => {
    const data = apiFixture('steam-appdetails.json') as AppDetailsResponse
    const store = storeInfo(parseAppDetails(data, '1145360'))!
    expect(store).toMatchObject({
      shortDescription: expect.stringContaining('Défiez le dieu des morts'),
      genres: ['Action', 'Indépendant', 'RPG'],
      developers: ['Supergiant Games'],
      publishers: ['Supergiant Games'],
      releaseDate: '17 sept. 2020',
      comingSoon: false,
      platforms: ['windows', 'mac'],
      price: '24,50 €',
      discountPercent: 0,
      controller: 'full'
    })
    expect(store.features).toContain('Steam Cloud')
    expect(store.screenshots).toHaveLength(4)
    expect(proxied(store.screenshots[0]!.fullUrl)).toMatch(/\/ss_.*\.1920x1080\.jpg/)
    expect(store.requirements.minimum).toContainEqual({
      label: 'Mémoire vive',
      value: '4 GB de mémoire'
    })
    expect(store.requirements.minimum[0]).toEqual({
      label: "Système d'exploitation",
      value: 'Windows 7 SP1'
    })
    expect(store.requirements.recommended).toHaveLength(5)
    expect(store.languages[0]).toEqual({ name: 'Anglais', audio: true })
    expect(store.languages).toContainEqual({ name: 'Français', audio: false })
    expect(store.languages.at(-1)).toEqual({ name: 'Japonais', audio: false })

    // About: headings and paragraphs, Steam's decorative videos dropped.
    expect(store.about[0]).toMatchObject({
      kind: 'text',
      text: expect.stringMatching(/^Hades est/)
    })
    expect(store.about).toContainEqual({
      kind: 'heading',
      text: 'LUTTEZ POUR ÉCHAPPER AUX ENFERS'
    })
    expect(store.about.every((b) => b.kind !== 'text' || !/<|webm/.test(b.text))).toBe(true)
    expect(storeInfo(null)).toBeNull()
  })

  it('parses store HTML edge cases', () => {
    expect(
      storeAbout(
        '<p>Un &amp; deux</p><ul><li>Point A</li><li>Point B</li></ul>' +
          '<img src="https://shared.akamai.steamstatic.com/a.gif"><img src="https://evil.example/b.png">'
      )
    ).toEqual([
      { kind: 'text', text: 'Un & deux' },
      { kind: 'text', text: '• Point A' },
      { kind: 'text', text: '• Point B' },
      { kind: 'image', url: remoteImageUrl('https://shared.akamai.steamstatic.com/a.gif') }
    ])
    expect(storeAbout(undefined)).toEqual([])
    // Inline tags leave no space before punctuation.
    expect(htmlText('de <strong>Bastion</strong>, la<br>suite')).toBe('de Bastion, la suite')
    expect(parseRequirements('<ul><li>Connexion internet requise</li></ul>')).toEqual([
      { label: '', value: 'Connexion internet requise' }
    ])
    expect(parseLanguages('Anglais, Français<strong>*</strong>')).toEqual([
      { name: 'Anglais', audio: false },
      { name: 'Français', audio: true }
    ])
    const free = storeInfo({ is_free: true, pc_requirements: [], controller_support: 'none' })!
    expect(free).toMatchObject({ price: 'Gratuit', controller: null, platforms: [] })
    expect(free.requirements).toEqual({ minimum: [], recommended: [] })
  })

  it('builds mp4 trailers from the app details movie ids', () => {
    const data = apiFixture('steam-appdetails.json') as AppDetailsResponse
    const details = parseAppDetails(data, '1145360')
    expect(details?.website).toBe('http://www.supergiantgames.com')
    expect(details?.metacritic?.score).toBe(93)
    expect(parseAppDetails(data, '1')).toBeNull()
    expect(parseAppDetails({ '7': { success: false } }, '7')).toBeNull()

    const videos = steamVideos(details, '1145360')
    expect(videos).toHaveLength(3)
    expect(videos[0]).toMatchObject({
      id: 'steam-256801252',
      title: 'Hades - v1.0 Launch Trailer',
      kind: 'steam',
      sources: [
        'https://video.akamai.steamstatic.com/store_trailers/256801252/movie_max.mp4',
        'https://video.akamai.steamstatic.com/store_trailers/256801252/movie480.mp4'
      ],
      pageUrl: 'https://store.steampowered.com/app/1145360/'
    })
    expect(proxied(videos[0]!.posterUrl!)).toMatch(/steamstatic\.com\/.*256801252/)
    expect(steamVideos(null, '1')).toEqual([])
  })

  it('reads news: official flag, plain summary, first allowed image', () => {
    const news = parseNews(apiFixture('steam-news.json') as NewsResponse)
    expect(news).toHaveLength(4)
    const [concert, press] = news
    expect(concert).toMatchObject({
      id: '1835236783574995',
      title: 'Watch the Hades Orchestral Concert, Live from London!',
      official: true,
      feed: 'Annonce officielle',
      date: 1781628906000
    })
    expect(concert!.summary).not.toMatch(/\[|\]|STEAM_CLAN_IMAGE/)
    expect(concert!.summary.length).toBeLessThanOrEqual(281)
    expect(proxied(concert!.imageUrl!)).toBe(
      'https://clan.akamai.steamstatic.com/images/43315153/aad983f32d27d927f5cc178938d011eb28363d3c.png'
    )
    // Press article: its image is on a host Shelf does not proxy.
    expect(press).toMatchObject({ official: false, feed: 'Rock, Paper, Shotgun', imageUrl: null })
    expect(press!.summary).not.toMatch(/<|>/)
  })

  it("shows the game's header on news without a usable image", () => {
    const header = remoteImageUrl(steamHeaderUrl('1145360'))
    const [concert, press] = parseNews(apiFixture('steam-news.json') as NewsResponse, header)
    expect(proxied(press!.imageUrl!)).toBe(
      'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg'
    )
    expect(concert!.imageUrl).not.toBe(header)
  })

  it('cleans BBCode and HTML from summaries', () => {
    expect(newsSummary('[b]Bold[/b] &amp; <i>it</i> [url=https://x.y]link[/url]')).toBe(
      'Bold & it link'
    )
    expect(newsSummary('one two three four five', 14)).toBe('one two three…')
    expect(newsImage('[img src="https://clan.akamai.steamstatic.com/images/1/a.png"][/img]')).toBe(
      remoteImageUrl('https://clan.akamai.steamstatic.com/images/1/a.png')
    )
    expect(newsImage('no image')).toBeNull()
  })

  it('reads the review summary and the players online', () => {
    const reviews = parseReviews(apiFixture('steam-storebrowse.json') as StoreBrowseResponse, '620')
    expect(reviews).toEqual({
      label: 'extrêmement positives',
      score: 9,
      percentPositive: 98,
      count: 392690,
      url: 'https://steamcommunity.com/app/620/reviews/'
    })
    expect(parseReviews({ response: { store_items: [] } }, '620')).toBeNull()
    expect(parsePlayers(apiFixture('steam-players.json') as never)).toBe(1664)
    expect(parsePlayers({ response: { result: 42 } })).toBeNull()
  })

  it('reads community shares with proxied previews', () => {
    const items = parseCommunity(apiFixture('steam-community.json') as QueryFilesResponse)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: '3301234567',
      title: 'Zagreus au bord du Styx',
      description: 'Capture prise après la 30e évasion.',
      url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3301234567',
      votesUp: 87,
      createdAt: 1729000000000
    })
    expect(proxied(items[0]!.previewUrl!)).toBe(
      'https://images.steamusercontent.com/ugc/1111/AAAA/'
    )
    expect(items[1]).toMatchObject({ title: 'Sans titre', previewUrl: null, votesUp: 0 })
  })

  it('merges achievements: unlocked first, then by rarity, icons filtered', () => {
    const schema = apiFixture('steam-achievements-schema.json') as SchemaResponse
    const player = apiFixture('steam-achievements-player.json') as PlayerAchievementsResponse
    const global = apiFixture('steam-achievements-global.json') as GlobalPercentagesResponse
    const view = mergeAchievements(schema, player, global, 'unused')
    expect(view).toMatchObject({ total: 3, unlocked: 1, note: null })
    expect(view.items.map((a) => a.id)).toEqual([
      'AchClearTartarus',
      'AchClearAsphodel',
      'AchSecretEnding'
    ])
    expect(view.items[0]).toMatchObject({
      name: 'Évadé du Tartare',
      unlocked: true,
      unlockedAt: 1600346400000,
      percent: 81.8
    })
    expect(proxied(view.items[1]!.iconUrl!)).toMatch(/asphodel_gray\.jpg$/)
    expect(view.items[2]).toMatchObject({ hidden: true, iconUrl: null, percent: 3.4 })

    const anonymous = mergeAchievements(schema, null, null, 'Pas de compte')
    expect(anonymous).toMatchObject({ total: 3, unlocked: null, note: 'Pas de compte' })
    expect(anonymous.items.every((a) => a.unlocked === null && a.percent === null)).toBe(true)
  })
})

describe('links and IGDB videos', () => {
  it('classifies links by host, removes duplicates and sorts them', () => {
    expect(linkKind(new URL('https://hades.fandom.com/wiki/Zagreus'))).toBe('wiki')
    expect(linkKind(new URL('https://discord.gg/abc'))).toBe('discord')
    const links = buildLinks('http://www.supergiantgames.com', [
      'https://www.reddit.com/r/HadesTheGame',
      'https://store.steampowered.com/app/1145360/',
      'https://en.wikipedia.org/wiki/Hades_(video_game)',
      'https://www.supergiantgames.com/',
      'javascript:alert(1)',
      'not a url'
    ])
    expect(links).toEqual([
      { kind: 'official', label: 'Site officiel', url: 'https://www.supergiantgames.com/' },
      { kind: 'steam', label: 'Page Steam', url: 'https://store.steampowered.com/app/1145360/' },
      {
        kind: 'wiki',
        label: 'Wikipédia',
        url: 'https://en.wikipedia.org/wiki/Hades_(video_game)'
      },
      { kind: 'reddit', label: 'Reddit', url: 'https://www.reddit.com/r/HadesTheGame' }
    ])
  })

  it('turns IGDB video ids into privacy-enhanced YouTube embeds', () => {
    const videos = youtubeVideos([
      { video_id: 'dQw4w9WgXcQ', name: 'Trailer' },
      { video_id: '"/>' }
    ])
    expect(videos).toEqual([
      {
        id: 'youtube-dQw4w9WgXcQ',
        title: 'Trailer',
        kind: 'youtube',
        posterUrl: remoteImageUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'),
        sources: ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0'],
        pageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      }
    ])
  })

  it('fetches IGDB videos and websites', async () => {
    const fetch = fakeFetch([
      ['id.twitch.tv', () => json(apiFixture('twitch-token.json'))],
      [
        'api.igdb.com/v4/games',
        () =>
          json([
            {
              id: 113112,
              videos: [{ video_id: 'abc123def', name: 'Launch' }],
              websites: [{ url: 'https://hades.fandom.com' }, {}]
            }
          ])
      ]
    ])
    const extras = await new IgdbClient('id', 'secret', fetch).extras(113112)
    expect(extras).toEqual({
      videos: [{ video_id: 'abc123def', name: 'Launch' }],
      websites: ['https://hades.fandom.com']
    })
    expect(String(fetch.calls[1]!.init?.body)).toContain('where id = 113112')
  })
})

describe('Steam appid on games', () => {
  let handle: DatabaseHandle
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
  })
  afterEach(() => handle.close())

  it('validates the appid typed by the user', () => {
    expect(steamAppId(' 1145360 ')).toBe('1145360')
    expect(steamAppId('')).toBeNull()
    expect(steamAppId(null)).toBeNull()
    expect(() => steamAppId('abc')).toThrow(/AppID Steam/)
    expect(() => steamAppId('0')).toThrow(/AppID Steam/)
    expect(validateGamePatch({ steamAppId: '620' })).toEqual({ steamAppId: '620' })
  })

  it('defaults to the sourceId for Steam games', () => {
    const steam = handle.db
      .insert(games)
      .values({ title: 'Hades', source: 'steam', sourceId: '1145360' })
      .returning()
      .get()
    expect(getGame(handle.db, steam.id).steamAppId).toBe('1145360')
    const manual = createManualGame(handle.db, {
      title: 'Manual',
      executablePath: process.execPath,
      launchArgs: null,
      installPath: null
    })
    expect(manual.steamAppId).toBeNull()
  })
})

describe('InsightsService', () => {
  let handle: DatabaseHandle
  let clock: number
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    clock = 1_000_000
  })
  afterEach(() => handle.close())

  const addGame = (title: string, source: 'steam' | 'epic' = 'epic', sourceId = title) =>
    handle.db.insert(games).values({ title, source, sourceId }).returning().get().id

  const steamApi = (overrides: Parameters<typeof fakeFetch>[0] = []) =>
    fakeFetch([
      ...overrides,
      ['/api/storesearch/', () => json(apiFixture('steam-storesearch.json'))],
      ['/api/appdetails', () => json(apiFixture('steam-appdetails.json'))],
      ['IStoreBrowseService/GetItems', () => json(apiFixture('steam-storebrowse.json'))],
      ['GetNumberOfCurrentPlayers', () => json(apiFixture('steam-players.json'))],
      ['GetNewsForApp', () => json(apiFixture('steam-news.json'))],
      ['QueryFiles', () => json(apiFixture('steam-community.json'))],
      ['GetSchemaForGame', () => json(apiFixture('steam-achievements-schema.json'))],
      ['GetPlayerAchievements', () => json(apiFixture('steam-achievements-player.json'))],
      ['GetGlobalAchievementPercentages', () => json(apiFixture('steam-achievements-global.json'))]
    ])

  const service = (fetch: ReturnType<typeof fakeFetch>, deps: Partial<InsightsDeps> = {}) =>
    new InsightsService({
      db: handle.db,
      steamCredentials: () => ({ apiKey: 'KEY', steamId: '76561197960287930' }),
      igdbExtras: async () => null,
      fetch,
      now: () => clock,
      ...deps
    })

  it('uses the Steam appid of Steam games without searching', async () => {
    const fetch = steamApi()
    const id = addGame('Hades', 'steam', '1145360')
    const insights = await service(fetch).overview(id)
    expect(insights).toMatchObject({
      steamAppId: '1145360',
      playersOnline: 1664,
      metacritic: { score: 93 },
      achievementsTotal: 49,
      steamKey: true
    })
    expect(insights.videos).toHaveLength(3)
    expect(insights.store?.developers).toEqual(['Supergiant Games'])
    expect(insights.links.map((l) => l.kind)).toEqual(['official', 'steam', 'community'])
    expect(fetch.calls.some((c) => c.url.includes('storesearch'))).toBe(false)
  })

  it('finds the appid of other games by title, once, and saves it', async () => {
    const fetch = steamApi()
    const id = addGame('Portal 2')
    const insights = service(fetch)
    expect(await insights.steamAppId(id)).toBe('620')
    expect(handle.db.select().from(games).where(eq(games.id, id)).get()?.steamAppId).toBe('620')
    await insights.steamAppId(id)
    expect(fetch.calls.filter((c) => c.url.includes('storesearch'))).toHaveLength(1)
    expect(fetch.calls[0]!.url).toContain('term=Portal+2')
  })

  it('searches again only when the title changed; no match leaves the game alone', async () => {
    const fetch = steamApi()
    const id = addGame('Obscure Game')
    const insights = service(fetch)
    expect(await insights.steamAppId(id)).toBeNull()
    expect(await insights.steamAppId(id)).toBeNull()
    expect(fetch.calls).toHaveLength(1)
    await expect(insights.news(id)).rejects.toThrow(NO_STEAM_PAGE)
    const overview = await insights.overview(id)
    expect(overview).toMatchObject({ steamAppId: null, videos: [], links: [], reviews: null })
  })

  it('keeps the other blocks when one service fails', async () => {
    const fetch = steamApi([
      ['IStoreBrowseService', () => json({}, 500)],
      ['GetNumberOfCurrentPlayers', () => Promise.reject(new Error('offline'))]
    ])
    const id = addGame('Hades', 'steam', '1145360')
    const insights = await service(fetch).overview(id)
    expect(insights.reviews).toBeNull()
    expect(insights.playersOnline).toBeNull()
    expect(insights.videos).toHaveLength(3)
  })

  it('adds IGDB videos and websites when the game has an IGDB id', async () => {
    const fetch = steamApi()
    const id = addGame('Hades', 'steam', '1145360')
    handle.db.update(games).set({ igdbId: 113112 }).where(eq(games.id, id)).run()
    const insights = await service(fetch, {
      igdbExtras: async () => ({
        videos: [{ video_id: 'abc123def', name: 'IGDB' }],
        websites: ['https://discord.gg/hades']
      })
    }).overview(id)
    expect(insights.videos.at(-1)?.kind).toBe('youtube')
    expect(insights.links.some((l) => l.kind === 'discord')).toBe(true)
  })

  it('keeps responses for the TTL, then asks again', async () => {
    const fetch = steamApi()
    const id = addGame('Hades', 'steam', '1145360')
    const insights = service(fetch)
    await insights.news(id)
    await insights.news(id)
    expect(fetch.calls.filter((c) => c.url.includes('GetNewsForApp'))).toHaveLength(1)
    clock += 11 * 60_000
    await insights.news(id)
    expect(fetch.calls.filter((c) => c.url.includes('GetNewsForApp'))).toHaveLength(2)
  })

  it('does not keep failures', async () => {
    let fail = true
    const fetch = steamApi([
      ['GetNewsForApp', () => (fail ? json({}, 503) : json(apiFixture('steam-news.json')))]
    ])
    const id = addGame('Hades', 'steam', '1145360')
    const insights = service(fetch)
    await expect(insights.news(id)).rejects.toThrow(/HTTP 503/)
    fail = false
    expect(await insights.news(id)).toHaveLength(4)
  })

  it('needs a Steam account for community shares and achievements', async () => {
    const id = addGame('Hades', 'steam', '1145360')
    const insights = service(steamApi(), { steamCredentials: () => null })
    await expect(insights.community(id, 'screenshots')).rejects.toThrow(NO_STEAM_ACCOUNT)
    await expect(insights.achievements(id)).rejects.toThrow(NO_STEAM_ACCOUNT)
    expect((await insights.overview(id)).steamKey).toBe(false)
  })

  it('queries community shares by kind with the account key', async () => {
    const fetch = steamApi()
    const id = addGame('Hades', 'steam', '1145360')
    const items = await service(fetch).community(id, 'guides')
    expect(items).toHaveLength(2)
    const url = new URL(fetch.calls.find((c) => c.url.includes('QueryFiles'))!.url)
    expect(url.searchParams.get('key')).toBe('KEY')
    expect(url.searchParams.get('appid')).toBe('1145360')
    expect(url.searchParams.get('filetype')).toBe('10')
  })

  it('explains a refused key on community shares', async () => {
    const fetch = steamApi([['QueryFiles', () => json({}, 403)]])
    const id = addGame('Hades', 'steam', '1145360')
    await expect(service(fetch).community(id, 'artwork')).rejects.toThrow(/Réglages › Comptes/)
  })

  it('shows achievement progress for Steam games only', async () => {
    const fetch = steamApi()
    const steam = addGame('Hades', 'steam', '1145360')
    const epic = addGame('Portal 2')
    const insights = service(fetch)

    const mine = await insights.achievements(steam)
    expect(mine).toMatchObject({ total: 3, unlocked: 1, note: null })
    const player = fetch.calls.find((c) => c.url.includes('GetPlayerAchievements'))!
    expect(new URL(player.url).searchParams.get('steamid')).toBe('76561197960287930')

    const other = await insights.achievements(epic)
    expect(other.unlocked).toBeNull()
    expect(other.note).toMatch(/bibliothèque Steam/)
  })

  it('explains a private profile and handles games without achievements', async () => {
    const id = addGame('Hades', 'steam', '1145360')
    const privateProfile = steamApi([['GetPlayerAchievements', () => json({}, 403)]])
    const view = await service(privateProfile).achievements(id)
    expect(view.unlocked).toBeNull()
    expect(view.note).toMatch(/profil Steam/)

    const none = steamApi([
      ['GetSchemaForGame', () => json(apiFixture('steam-achievements-schema-empty.json'))]
    ])
    expect(await service(none).achievements(id)).toEqual({
      total: 0,
      unlocked: null,
      items: [],
      note: null
    })
    expect(none.calls.some((c) => c.url.includes('GetPlayerAchievements'))).toBe(false)
  })
})
