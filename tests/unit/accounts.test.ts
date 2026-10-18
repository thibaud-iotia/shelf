import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { epicLegendaryProvider, parseLegendaryList } from '../../src/main/accounts/epic-legendary'
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
import { games } from '../../src/main/db/schema'
import { closeSession, listGames, openSession } from '../../src/main/games/repository'
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
      playtimeMin: 2535
    })
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
      INSERT INTO GameTimes VALUES (1, 'gog_1207658924', 95, 0), (1, 'steam_620', 30, 0);
    `)
    withTimes.close()
    expect(owned().map((g) => g.playtimeMin)).toEqual([95, 0])
    await expect(gogGalaxyProvider(() => []).connect({})).rejects.toThrow(/GOG Galaxy introuvable/)
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
    const run = async (file: string, args: string[]) => {
      if (file === 'legendary') throw enoent
      return args[0] === 'status'
        ? fixture('legendary-status.json')
        : fixture('legendary-list.json')
    }
    const provider = epicLegendaryProvider(() => ['legendary', '/opt/heroic/legendary'], run)
    expect(await provider.connect({})).toMatchObject({ displayName: 'epicfan', secret: null })
    expect((await provider.fetchOwned({ externalUserId: 'epicfan' }, null)).games).toHaveLength(2)

    const anon = epicLegendaryProvider(
      () => ['/x'],
      async () => fixture('legendary-status-anon.json')
    )
    await expect(anon.connect({})).rejects.toThrow(/legendary auth/)
    const missing = epicLegendaryProvider(
      () => ['legendary'],
      async () => Promise.reject(enoent)
    )
    await expect(missing.connect({})).rejects.toThrow(/Legendary introuvable/)
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
    expect(result).toEqual({ added: 1, updated: 1 })
    const rows = handle.db.select().from(games).all()
    expect(rows.map((r) => [r.title, r.installState, r.externalPlaytimeMin])).toEqual([
      ['Hades', 'installed', 2535],
      ['Portal 2', 'not_installed', 10]
    ])
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
