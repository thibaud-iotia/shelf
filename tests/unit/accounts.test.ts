import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decodeCatalogCache,
  epicLauncherProvider,
  parseEpicCatalog
} from '../../src/main/accounts/epic-launcher'
import {
  epicLegendaryProvider,
  parseLegendaryList,
  type LegendaryBinary
} from '../../src/main/accounts/epic-legendary'
import { gogGalaxyProvider, readGalaxyOwned } from '../../src/main/accounts/gog-galaxy'
import { codeFromRedirect, gogOAuthProvider } from '../../src/main/accounts/gog-oauth'
import { fetchItchOwned, itchProvider } from '../../src/main/accounts/itch'
import { AccountService, upsertOwned } from '../../src/main/accounts/service'
import {
  fetchSteamOwned,
  parseSteamIdInput,
  resolveSteamId,
  steamProvider
} from '../../src/main/accounts/steam'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { gameDlcs, games } from '../../src/main/db/schema'
import {
  closeSession,
  deleteGame,
  getGame,
  getGameDetail,
  listGames,
  openSession
} from '../../src/main/games/repository'
import { assertAllowed, requestJson } from '../../src/main/net/http'
import { SecretStore } from '../../src/main/secrets/store'
import { apiFixture, fakeCipher, fakeFetch, json, MIGRATIONS, tempDir } from './helpers'

const KEY = '0123456789ABCDEF0123456789ABCDEF'

describe('http allow-list', () => {
  it('only lets the listed APIs through, over https', () => {
    expect(assertAllowed('https://api.steampowered.com/x').hostname).toBe('api.steampowered.com')
    expect(() => assertAllowed('https://evil.example.com/')).toThrow(/refusé/)
    expect(() => assertAllowed('http://api.steampowered.com/')).toThrow(/refusé/)
    expect(() => assertAllowed('not a url')).toThrow(/invalide/)
  })

  it('maps HTTP failures to clear error codes', async () => {
    const opts = (status: number) => ({
      service: 'Test',
      fetch: fakeFetch([['', () => json({}, status)]])
    })
    await expect(requestJson('https://api.itch.io/a', {}, opts(401))).rejects.toMatchObject({
      code: 'AUTH'
    })
    await expect(requestJson('https://api.itch.io/a', {}, opts(429))).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    })
    await expect(requestJson('https://api.itch.io/a', {}, opts(500))).rejects.toMatchObject({
      code: 'NETWORK'
    })
    const down = fakeFetch([['', () => Promise.reject(new Error('ENOTFOUND'))]])
    await expect(
      requestJson('https://api.itch.io/a', {}, { service: 'itch.io', fetch: down })
    ).rejects.toThrow('Impossible de joindre itch.io : ENOTFOUND')
  })
})

describe('Steam Web API', () => {
  it('parses SteamID inputs', () => {
    expect(parseSteamIdInput('76561197960287930')).toEqual({
      kind: 'id64',
      value: '76561197960287930'
    })
    expect(parseSteamIdInput('https://steamcommunity.com/profiles/76561197960287930/')).toEqual({
      kind: 'id64',
      value: '76561197960287930'
    })
    expect(parseSteamIdInput('https://steamcommunity.com/id/gaben')).toEqual({
      kind: 'vanity',
      value: 'gaben'
    })
    expect(parseSteamIdInput('gaben')).toEqual({ kind: 'vanity', value: 'gaben' })
    expect(() => parseSteamIdInput('')).toThrow()
  })

  it('resolves vanity URLs', async () => {
    const fetch = fakeFetch([
      ['vanityurl=gaben', () => json(apiFixture('steam-resolve.json'))],
      ['vanityurl=nobody', () => json(apiFixture('steam-resolve-nomatch.json'))]
    ])
    expect(await resolveSteamId(KEY, { kind: 'vanity', value: 'gaben' }, { fetch })).toBe(
      '76561197960287930'
    )
    await expect(
      resolveSteamId(KEY, { kind: 'vanity', value: 'nobody' }, { fetch })
    ).rejects.toThrow(/nobody/)
  })

  it('reads owned games with playtime, and explains private profiles', async () => {
    const fetch = fakeFetch([
      ['steamid=1', () => json(apiFixture('steam-owned.json'))],
      ['steamid=2', () => json(apiFixture('steam-owned-private.json'))],
      ['steamid=3', () => json({}, 403)]
    ])
    const owned = await fetchSteamOwned(KEY, '1', { fetch })
    expect(owned[0]).toEqual({
      source: 'steam',
      sourceId: '1145360',
      title: 'Hades',
      playtimeMin: 2535,
      lastPlayedAt: 1793800000_000
    })
    expect(owned[1]).not.toHaveProperty('lastPlayedAt') // rtime_last_played absent or 0
    expect(fetch.calls[0]?.url).toContain('include_appinfo=1&include_played_free_games=1')
    await expect(fetchSteamOwned(KEY, '2', { fetch })).rejects.toThrow(/Détails des jeux/)
    await expect(fetchSteamOwned(KEY, '3', { fetch })).rejects.toThrow(/Clé API Steam refusée/)
  })

  it('connects: validates the key, resolves the id, names the account', async () => {
    const fetch = fakeFetch([
      ['ResolveVanityURL', () => json(apiFixture('steam-resolve.json'))],
      ['GetOwnedGames', () => json(apiFixture('steam-owned.json'))],
      ['GetPlayerSummaries', () => json(apiFixture('steam-summaries.json'))]
    ])
    const provider = steamProvider({ fetch })
    await expect(provider.connect({ apiKey: 'short', steamId: 'gaben' })).rejects.toThrow(
      /32 caractères/
    )
    expect(await provider.connect({ apiKey: KEY, steamId: 'gaben' })).toEqual({
      displayName: 'Gabe',
      externalUserId: '76561197960287930',
      secret: KEY
    })
  })
})

describe('itch.io API', () => {
  it('pages through owned keys, games only', async () => {
    const fetch = fakeFetch([
      ['page=1', () => json(apiFixture('itch-owned-1.json'))],
      ['page=2', () => json(apiFixture('itch-owned-2.json'))]
    ])
    const owned = await fetchItchOwned('key', { fetch })
    expect(owned.map((g) => g.title)).toEqual(['Baba Is You', 'Celeste Classic'])
    expect(new Headers(fetch.calls[0]?.init?.headers).get('authorization')).toBe('Bearer key')
  })

  it('connects with the profile and reports invalid keys', async () => {
    const ok = itchProvider({
      fetch: fakeFetch([['/profile', () => json(apiFixture('itch-profile.json'))]])
    })
    expect(await ok.connect({ apiKey: ' key ' })).toEqual({
      displayName: 'Leaf',
      externalUserId: '1234',
      secret: 'key'
    })
    const bad = itchProvider({
      fetch: fakeFetch([['/profile', () => json(apiFixture('itch-invalid.json'), 403)]])
    })
    await expect(bad.connect({ apiKey: 'x' })).rejects.toThrow(/Clé API itch.io refusée/)
  })
})

describe('GOG', () => {
  it('reads owned games from the Galaxy 2.0 database (option A)', async () => {
    const file = join(tempDir(), 'galaxy-2.0.db')
    const db = new Database(file)
    db.exec(`
      CREATE TABLE LibraryReleases (releaseKey TEXT, userId INTEGER);
      CREATE TABLE GamePieceTypes (id INTEGER PRIMARY KEY, type TEXT);
      CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INTEGER, value TEXT);
      INSERT INTO GamePieceTypes VALUES (1, 'title'), (2, 'originalTitle'), (3, 'meta');
      INSERT INTO LibraryReleases VALUES ('gog_1207658924', 1), ('steam_620', 1), ('gog_42', 1);
      INSERT INTO GamePieces VALUES ('gog_1207658924', 1, 1, '{"title":"Unreal Tournament 2004"}');
      INSERT INTO GamePieces VALUES ('gog_1207658924', 3, 1, '{"x":1}');
      INSERT INTO GamePieces VALUES ('steam_620', 1, 1, '{"title":"Portal 2"}');
      INSERT INTO GamePieces VALUES ('gog_42', 2, 1, '{"title":"Original Only"}');
    `)
    db.close()
    const owned = () => readGalaxyOwned(file).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    expect(owned()).toEqual([
      { source: 'gog', sourceId: '1207658924', title: 'Unreal Tournament 2004' },
      { source: 'gog', sourceId: '42', title: 'Original Only' }
    ])

    // Newer databases also keep the time played through Galaxy.
    const withTimes = new Database(file)
    withTimes.exec(`
      CREATE TABLE GameTimes (userId INTEGER, releaseKey TEXT, minutesInGame INTEGER, lastSessionEnd INTEGER);
      INSERT INTO GameTimes VALUES (1, 'gog_1207658924', 95, 1793800000), (1, 'steam_620', 30, 0);
    `)
    withTimes.close()
    expect(owned().map((g) => g.playtimeMin)).toEqual([95, 0])
    expect(owned().map((g) => g.lastPlayedAt)).toEqual([1793800000_000, undefined])
    await expect(gogGalaxyProvider(() => []).connect({})).rejects.toThrow(/GOG Galaxy introuvable/)
  })

  it('Galaxy: add-ons are attached to their base game, hidden editions left out', () => {
    const file = join(tempDir(), 'galaxy-2.0.db')
    const db = new Database(file)
    db.exec(`
      CREATE TABLE LibraryReleases (releaseKey TEXT, userId INTEGER);
      CREATE TABLE GamePieceTypes (id INTEGER PRIMARY KEY, type TEXT);
      CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INTEGER, value TEXT);
      CREATE TABLE ReleaseProperties (releaseKey TEXT, isDlc INTEGER, isVisibleInLibrary INTEGER, gameId TEXT);
      INSERT INTO GamePieceTypes VALUES (1, 'title'), (2, 'dlcs'), (3, 'allGameReleases');
      INSERT INTO LibraryReleases VALUES
        ('gog_1', 1), ('gog_10', 1), ('gog_11', 1), ('gog_12', 1), ('gog_13', 1), ('gog_14', 1),
        ('gog_2', 1), ('gog_20', 1);
      INSERT INTO GamePieces VALUES
        ('gog_1', 1, 1, '{"title":"The Witcher 3: Wild Hunt"}'),
        ('gog_1', 2, 1, '{"dlcs":["gog_10","gog_11"]}'),
        ('gog_1', 3, 1, '{"releases":["gog_1","gog_9","steam_292030"]}'),
        -- Another edition, not owned, listing the "[A]" copies of the same add-ons.
        ('gog_9', 2, 1, '{"dlcs":["gog_12","gog_13","gog_14"]}'),
        ('gog_10', 1, 1, '{"title":"Alternative Look for Ciri"}'),
        ('gog_11', 1, 1, '{"title":"Hearts of Stone"}'),
        ('gog_12', 1, 1, '{"title":"Alternative Look for Ciri [A]"}'),
        ('gog_13', 1, 1, '{"title":"dlc_15_a"}'),
        ('gog_14', 1, 1, '{"title":"Temerian Armor Set [A]"}'),
        ('gog_2', 1, 1, '{"title":"The Witcher 3: Wild Hunt"}'),
        ('gog_20', 1, 1, '{"title":"Cyberpunk 2077 Goodies Collection"}');
      INSERT INTO ReleaseProperties VALUES
        ('gog_1', 0, 1, 'a'), ('gog_10', 1, 1, 'b'), ('gog_11', 1, 1, 'c'), ('gog_12', 1, 1, 'd'),
        ('gog_13', 1, 1, 'e'), ('gog_14', 1, 1, 'f'), ('gog_2', 0, 0, 'g'), ('gog_20', 1, 1, 'h');
    `)
    db.close()
    const owned = readGalaxyOwned(file).sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    expect(
      owned.map(({ sourceId, title, dlcOf, unlisted }) => ({ sourceId, title, dlcOf, unlisted }))
    ).toEqual([
      { sourceId: '1', title: 'The Witcher 3: Wild Hunt', dlcOf: undefined, unlisted: undefined },
      { sourceId: '10', title: 'Alternative Look for Ciri', dlcOf: '1', unlisted: undefined },
      { sourceId: '11', title: 'Hearts of Stone', dlcOf: '1', unlisted: undefined },
      // Same add-on bought with another edition: kept once.
      { sourceId: '12', title: 'Alternative Look for Ciri [A]', dlcOf: undefined, unlisted: true },
      // Internal placeholder name.
      { sourceId: '13', title: 'dlc_15_a', dlcOf: undefined, unlisted: true },
      // Only the "[A]" copy is owned: attached through the edition, suffix dropped.
      { sourceId: '14', title: 'Temerian Armor Set', dlcOf: '1', unlisted: undefined },
      // Edition hidden by Galaxy itself.
      { sourceId: '2', title: 'The Witcher 3: Wild Hunt', dlcOf: undefined, unlisted: true },
      // Add-on of a game not owned.
      {
        sourceId: '20',
        title: 'Cyberpunk 2077 Goodies Collection',
        dlcOf: undefined,
        unlisted: true
      }
    ])

    // Older databases without ReleaseProperties: the `dlcs` piece is enough.
    const old = new Database(file)
    old.exec('DROP TABLE ReleaseProperties')
    old.close()
    const fallback = readGalaxyOwned(file)
    expect(fallback.find((g) => g.sourceId === '10')).toMatchObject({ dlcOf: '1' })
    expect(fallback.find((g) => g.sourceId === '2')).not.toHaveProperty('unlisted')
  })

  it('OAuth (option B): code, token rotation, paginated products', async () => {
    expect(codeFromRedirect('https://embed.gog.com/on_login_success?origin=client&code=ABC')).toBe(
      'ABC'
    )
    expect(codeFromRedirect('https://login.gog.com/x?code=ABC')).toBeNull()

    const fetch = fakeFetch([
      ['auth.gog.com/token', () => json(apiFixture('gog-token.json'))],
      ['userData.json', () => json(apiFixture('gog-userdata.json'))],
      ['page=1', () => json(apiFixture('gog-products-1.json'))],
      ['page=2', () => json(apiFixture('gog-products-2.json'))]
    ])
    const provider = gogOAuthProvider({ fetch, login: async () => 'CODE' })
    expect(await provider.connect({})).toEqual({
      displayName: 'gogfan',
      externalUserId: '4815',
      secret: 'RT2'
    })
    expect(fetch.calls[0]?.url).toContain('grant_type=authorization_code&code=CODE')

    const result = await provider.fetchOwned({ externalUserId: '4815' }, 'RT1')
    expect(result.secret).toBe('RT2')
    expect(result.games.map((g) => g.title)).toEqual(['Unreal Tournament 2004', 'Disco Elysium'])
  })
})

describe('Epic via Legendary', () => {
  const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/api', name), 'utf8')

  it('parses `legendary list --json`', () => {
    expect(parseLegendaryList(fixture('legendary-list.json'))).toEqual([
      { source: 'epic', sourceId: 'Salt', title: 'Celeste' },
      { source: 'epic', sourceId: 'Fortnite', title: 'Fortnite' }
    ])
  })

  it('needs a logged-in Legendary, tries each binary', async () => {
    const enoent = Object.assign(new Error('spawn legendary ENOENT'), { code: 'ENOENT' })
    const run = async ({ file }: LegendaryBinary, args: string[]) => {
      if (file === 'legendary') throw enoent
      return args[0] === 'status'
        ? fixture('legendary-status.json')
        : fixture('legendary-list.json')
    }
    const provider = epicLegendaryProvider(
      () => [{ file: 'legendary' }, { file: '/opt/heroic/legendary' }],
      run
    )
    expect(await provider.connect({})).toMatchObject({ displayName: 'epicfan', secret: null })
    expect((await provider.fetchOwned({ externalUserId: 'epicfan' }, null)).games).toHaveLength(2)

    const anon = epicLegendaryProvider(
      () => [{ file: '/x' }],
      async () => fixture('legendary-status-anon.json')
    )
    await expect(anon.connect({})).rejects.toThrow(/legendary auth/)
    const missing = epicLegendaryProvider(
      () => [{ file: 'legendary' }],
      async () => Promise.reject(enoent)
    )
    await expect(missing.connect({})).rejects.toThrow(/Legendary introuvable/)
  })

  it('uses Heroic’s Legendary config when the standalone one has no account', async () => {
    const calls: LegendaryBinary[] = []
    const run = async (binary: LegendaryBinary, args: string[]) => {
      calls.push(binary)
      if (args[0] === 'list') return fixture('legendary-list.json')
      // Logged in only through Heroic's config folder.
      return binary.configPath
        ? fixture('legendary-status.json')
        : fixture('legendary-status-anon.json')
    }
    const heroic = { file: '/heroic/legendary', configPath: '/heroic/legendaryConfig/legendary' }
    const provider = epicLegendaryProvider(() => [{ file: 'legendary' }, heroic], run)
    expect(await provider.connect({})).toMatchObject({ displayName: 'epicfan' })
    expect((await provider.fetchOwned({ externalUserId: 'epicfan' }, null)).games).toHaveLength(2)
    expect(calls.at(-1)).toEqual(heroic)
  })
})

describe('Epic via the Epic Games Launcher cache', () => {
  const raw = () => readFileSync(join(__dirname, '../fixtures/api/epic-catcache.json'), 'utf8')
  const writeCache = (content: string) => {
    const file = join(tempDir(), 'catcache.bin')
    writeFileSync(file, content)
    return file
  }

  it('decodes catcache.bin (base64 JSON, or plain JSON)', () => {
    const items = JSON.parse(raw())
    expect(decodeCatalogCache(Buffer.from(raw()).toString('base64'))).toEqual(items)
    expect(decodeCatalogCache(`\n${raw()}\n`)).toEqual(items)
    expect(() => decodeCatalogCache('%%% not base64 %%%')).toThrow(/illisible/)
    expect(() => decodeCatalogCache(Buffer.from('{"a":1}').toString('base64'))).toThrow(/inattendu/)
  })

  it('keeps owned games, attaches add-ons, leaves engines, assets and hidden content out', () => {
    expect(parseEpicCatalog(JSON.parse(raw()))).toEqual([
      { source: 'epic', sourceId: 'Salt', title: 'Celeste' },
      { source: 'epic', sourceId: 'Fortnite', title: 'Fortnite' },
      {
        source: 'epic',
        sourceId: 'afdb5a85efcc45d8ae8e406e2121d81c',
        title: 'Fortnite Battle Royale',
        dlcOf: 'Fortnite'
      },
      { source: 'epic', sourceId: '04a54ed532ce4fbfbf8fd5833f60def0', title: 'Dying Light' },
      {
        source: 'epic',
        sourceId: 'f653266870894ee1acbb5250e3b04bd1',
        title: 'Dying Light The Following',
        dlcOf: '04a54ed532ce4fbfbf8fd5833f60def0'
      },
      // Add-on of a game the account does not own.
      {
        source: 'epic',
        sourceId: 'perilongorgon',
        title: 'The Outer Worlds Peril on Gorgon',
        unlisted: true
      },
      { source: 'epic', sourceId: 'InfinifactoryWin', title: 'Infinifactory' }
    ])
  })

  it('uses the app name of the current platform', () => {
    const ids = parseEpicCatalog(JSON.parse(raw()), 'Mac').map((g) => g.sourceId)
    expect(ids).toContain('InfinifactoryMac')
    expect(ids).not.toContain('InfinifactoryWin')
  })

  it('reads the cache without credentials, clear message when the launcher is missing', async () => {
    const file = writeCache(Buffer.from(raw()).toString('base64'))
    const provider = epicLauncherProvider(() => [join(tempDir(), 'absent.bin'), file], 'Windows')
    expect(provider.local).toBe(true)
    expect(await provider.connect({})).toEqual({
      displayName: 'Epic Games Launcher (local)',
      externalUserId: 'epic-launcher-local',
      secret: null
    })
    expect((await provider.fetchOwned({ externalUserId: 'x' }, null)).games).toHaveLength(7)

    await expect(epicLauncherProvider(() => []).connect({})).rejects.toThrow(
      /Bibliothèque Epic introuvable/
    )
    const broken = epicLauncherProvider(() => [writeCache('garbage!')])
    await expect(broken.connect({})).rejects.toThrow(/illisible/)
  })

  it('merges with the installed copy and lists the rest as not installed', async () => {
    const handle = openDatabase(':memory:', MIGRATIONS)
    try {
      // Fortnite detected through the launcher's `.item` manifest.
      handle.db
        .insert(games)
        .values({
          title: 'Fortnite',
          source: 'epic',
          sourceId: 'Fortnite',
          ownership: 'owned',
          installState: 'installed',
          executablePath: 'C:\\Fortnite\\FortniteLauncher.exe'
        })
        .run()
      const secrets = new SecretStore(join(tempDir(), 'secrets.json'), fakeCipher)
      const file = writeCache(Buffer.from(raw()).toString('base64'))
      const service = new AccountService(handle.db, secrets, [
        epicLauncherProvider(() => [file], 'Windows')
      ])
      const { account, sync } = await service.connect({ kind: 'epic-launcher' })
      expect(sync).toMatchObject({ added: 3, updated: 1, total: 4, error: null })
      expect(account).toMatchObject({ kind: 'epic-launcher', source: 'epic', gameCount: 4 })
      expect(secrets.has('account:epic-launcher:epic-launcher-local')).toBe(false)

      const rows = handle.db
        .select()
        .from(games)
        .all()
        .map((r) => [r.title, r.installState] as const)
        .sort((a, b) => a[0].localeCompare(b[0]))
      expect(rows).toEqual([
        ['Celeste', 'not_installed'],
        ['Dying Light', 'not_installed'],
        ['Fortnite', 'installed'],
        ['Infinifactory', 'not_installed']
      ])
      const dlcs = handle.db.select().from(gameDlcs).all()
      expect(dlcs.map((d) => d.title).sort()).toEqual([
        'Dying Light The Following',
        'Fortnite Battle Royale'
      ])

      // Local read: synced again at every startup, no duplicate rows.
      expect(await service.syncDue()).toMatchObject([
        { accountId: 'epic-launcher:epic-launcher-local', added: 0, updated: 4, error: null }
      ])
      expect(handle.db.select().from(games).all()).toHaveLength(4)
    } finally {
      handle.close()
    }
  })
})

describe('secrets', () => {
  it('stores encrypted values outside the database', () => {
    const file = join(tempDir(), 'secrets.json')
    const store = new SecretStore(file, fakeCipher)
    store.set('igdb.secret', 'hunter2')
    expect(readFileSync(file, 'utf8')).not.toContain('hunter2')
    expect(store.get('igdb.secret')).toBe('hunter2')
    expect(store.has('igdb.secret')).toBe(true)
    store.delete('igdb.secret')
    expect(store.get('igdb.secret')).toBeNull()

    const locked = new SecretStore(file, { ...fakeCipher, isAvailable: () => false })
    expect(() => locked.set('x', 'y')).toThrow(/chiffrement/)
  })
})

describe('AccountService', () => {
  let handle: DatabaseHandle
  let secrets: SecretStore
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    secrets = new SecretStore(join(tempDir(), 'secrets.json'), fakeCipher)
  })
  afterEach(() => handle.close())

  it('merges owned games with locally detected ones', () => {
    handle.db
      .insert(games)
      .values({
        title: 'Hades',
        source: 'steam',
        sourceId: '1145360',
        ownership: 'owned',
        installState: 'installed'
      })
      .run()
    const result = upsertOwned(
      handle.db,
      [
        { source: 'steam', sourceId: '1145360', title: 'Hades', playtimeMin: 2535 },
        { source: 'steam', sourceId: '620', title: 'Portal 2', playtimeMin: 10 }
      ],
      new Date()
    )
    expect(result).toEqual({ added: 1, updated: 1, dlcs: 0 })
    const rows = handle.db.select().from(games).all()
    expect(rows.map((r) => [r.title, r.installState, r.externalPlaytimeMin])).toEqual([
      ['Hades', 'installed', 2535],
      ['Portal 2', 'not_installed', 10]
    ])
  })

  it('attaches add-ons to their game and removes them from the library', () => {
    // A previous sync imported add-ons and a hidden edition as games.
    upsertOwned(
      handle.db,
      [
        { source: 'gog', sourceId: '1', title: 'The Witcher 3' },
        { source: 'gog', sourceId: '10', title: 'Alternative Look for Ciri' },
        { source: 'gog', sourceId: '2', title: 'The Witcher 3' },
        { source: 'gog', sourceId: '30', title: 'Goodies Collection' }
      ],
      new Date()
    )
    // …but one the user set up by hand is kept.
    handle.db
      .update(games)
      .set({ executablePath: 'C:/Games/goodies.exe' })
      .where(eq(games.sourceId, '30'))
      .run()

    const result = upsertOwned(
      handle.db,
      [
        { source: 'gog', sourceId: '10', title: 'Alternative Look for Ciri', dlcOf: '1' },
        { source: 'gog', sourceId: '1', title: 'The Witcher 3' },
        { source: 'gog', sourceId: '11', title: 'Hearts of Stone', dlcOf: '1' },
        { source: 'gog', sourceId: '12', title: 'Base not owned', dlcOf: '999' },
        { source: 'gog', sourceId: '2', title: 'The Witcher 3', unlisted: true },
        { source: 'gog', sourceId: '30', title: 'Goodies Collection', unlisted: true }
      ],
      new Date()
    )
    expect(result).toEqual({ added: 0, updated: 1, dlcs: 2 })
    expect(listGames(handle.db).map((g) => g.title)).toEqual([
      'Goodies Collection',
      'The Witcher 3'
    ])

    const witcher = listGames(handle.db).find((g) => g.sourceId === '1')!
    expect(getGameDetail(handle.db, witcher.id).dlcs.map((d) => d.title)).toEqual([
      'Alternative Look for Ciri',
      'Hearts of Stone'
    ])

    // Re-sync: same rows, no duplicates; deleting the game drops its add-ons.
    upsertOwned(
      handle.db,
      [{ source: 'gog', sourceId: '10', title: 'Alternative Look for Ciri', dlcOf: '1' }],
      new Date()
    )
    expect(handle.db.select().from(gameDlcs).all()).toHaveLength(2)
    deleteGame(handle.db, witcher.id)
    expect(handle.db.select().from(gameDlcs).all()).toHaveLength(0)
  })

  it('shows the launcher playtime, plus what Shelf measured outside of it', () => {
    upsertOwned(
      handle.db,
      [{ source: 'gog', sourceId: '1', title: 'UT', playtimeMin: 120 }],
      new Date()
    )
    const ut = listGames(handle.db)[0]!
    expect(ut).toMatchObject({ playtimeSec: 7200, localPlaytimeSec: 0, externalPlaytimeMin: 120 })

    // Executable launched by Shelf: the launcher never sees it, the times add up.
    const t0 = new Date('2026-10-18T20:00:00Z')
    closeSession(handle.db, openSession(handle.db, ut.id, t0), new Date(t0.getTime() + 600_000))
    expect(listGames(handle.db)[0]).toMatchObject({ playtimeSec: 7800, localPlaytimeSec: 600 })
  })

  it('takes the last play from the launcher when it is more recent than Shelf’s sessions', () => {
    const owned = (lastPlayedAt?: number) =>
      upsertOwned(
        handle.db,
        [
          {
            source: 'steam',
            sourceId: '1903340',
            title: 'Clair Obscur',
            playtimeMin: 3595,
            lastPlayedAt
          }
        ],
        new Date()
      )
    owned()
    const game = listGames(handle.db)[0]!
    expect(game).toMatchObject({ lastPlayedAt: null, lastSessionSec: null })

    // Played through Steam: a date without a session length.
    const yesterday = new Date('2026-11-04T21:00:00Z').getTime()
    owned(yesterday)
    expect(getGame(handle.db, game.id)).toMatchObject({
      lastPlayedAt: yesterday,
      lastSessionSec: null
    })

    // A later Shelf session wins, with its length.
    const t0 = new Date('2026-11-05T10:00:00Z')
    closeSession(handle.db, openSession(handle.db, game.id, t0), new Date(t0.getTime() + 600_000))
    expect(listGames(handle.db)[0]).toMatchObject({
      lastPlayedAt: t0.getTime(),
      lastSessionSec: 600
    })

    // A sync without a date keeps the known one.
    owned()
    expect(handle.db.select().from(games).get()?.externalLastPlayedAt?.getTime()).toBe(yesterday)
  })

  it('connects, syncs, stores the key in the vault only, disconnects', async () => {
    const fetch = fakeFetch([
      ['GetOwnedGames', () => json(apiFixture('steam-owned.json'))],
      ['GetPlayerSummaries', () => json(apiFixture('steam-summaries.json'))]
    ])
    let now = new Date('2026-10-18T10:00:00Z')
    const service = new AccountService(handle.db, secrets, [steamProvider({ fetch }) as never], {
      now: () => now
    })
    const { account, sync } = await service.connect({
      kind: 'steam',
      apiKey: KEY,
      steamId: '76561197960287930'
    })
    expect(account).toMatchObject({
      id: 'steam:76561197960287930',
      displayName: 'Gabe',
      gameCount: 3
    })
    expect(sync).toMatchObject({ added: 3, total: 3, error: null })
    expect(JSON.stringify(handle.sqlite.prepare('SELECT * FROM accounts').all())).not.toContain(KEY)
    expect(secrets.get('account:steam:76561197960287930')).toBe(KEY)

    expect(await service.syncDue()).toEqual([]) // synced just now
    now = new Date('2026-10-19T11:00:00Z')
    expect(await service.syncDue()).toHaveLength(1)
    // After a Steam session: only Steam accounts.
    expect((await service.syncSource('steam')).map((r) => r.accountId)).toEqual([account.id])
    expect(await service.syncSource('gog')).toEqual([])

    service.disconnect(account.id)
    expect(service.list()).toEqual([])
    expect(secrets.has('account:steam:76561197960287930')).toBe(false)
  })

  it('resyncs local libraries (GOG Galaxy) at every startup', async () => {
    const galaxy = {
      kind: 'gog-galaxy',
      source: 'gog',
      local: true,
      connect: async () => ({
        displayName: 'GOG Galaxy (local)',
        externalUserId: 'g',
        secret: null
      }),
      fetchOwned: async () => ({ games: [{ source: 'gog', sourceId: '1', title: 'UT2004' }] })
    } as const
    const service = new AccountService(handle.db, secrets, [galaxy as never])
    await service.connect({ kind: 'gog-galaxy' })
    // Synced just now, still due: a local read costs nothing.
    expect(await service.syncDue()).toMatchObject([{ accountId: 'gog-galaxy:g', error: null }])
  })

  it('keeps sync errors on the account instead of throwing', async () => {
    const fetch = fakeFetch([
      ['GetPlayerSummaries', () => json(apiFixture('steam-summaries.json'))],
      ['GetOwnedGames', () => json(apiFixture('steam-owned.json'))]
    ])
    const service = new AccountService(handle.db, secrets, [steamProvider({ fetch }) as never])
    const { account } = await service.connect({
      kind: 'steam',
      apiKey: KEY,
      steamId: '76561197960287930'
    })
    fetch.calls.length = 0
    const failing = new AccountService(handle.db, secrets, [
      steamProvider({ fetch: fakeFetch([['', () => json({}, 429)]]) }) as never
    ])
    const report = await failing.sync(account.id)
    expect(report.error).toMatch(/Trop de requêtes/)
    expect(failing.list()[0]?.lastError).toMatch(/Trop de requêtes/)
    expect(handle.db.select().from(games).where(eq(games.source, 'steam')).all()).toHaveLength(3)
  })

  it('refuses disabled providers (GOG option B flag)', async () => {
    const service = new AccountService(
      handle.db,
      secrets,
      [gogOAuthProvider({ login: async () => 'x' })],
      { isEnabled: (kind) => kind !== 'gog-oauth' }
    )
    await expect(service.connect({ kind: 'gog-oauth' })).rejects.toThrow(/pas activé/)
  })
})
