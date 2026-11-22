import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseGamesOwned,
  parseSession,
  profileTags,
  readOwned,
  rockstarSocialProvider,
  type SocialClubAccess,
  type SocialClubBrowser,
  type SocialClubSession
} from '../../src/main/accounts/rockstar-social'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games, playSessions } from '../../src/main/db/schema'
import { defaultSteamAppId } from '../../src/main/games/repository'
import { importRockstarSessions } from '../../src/main/games/rockstar-sessions'
import { withRockstarLink } from '../../src/main/insights/links'
import { RockstarLauncher, rockstarArgs } from '../../src/main/install/rockstar'
import { InstallService, type InstallTarget } from '../../src/main/install/service'
import type { LegendaryInstaller } from '../../src/main/install/legendary'
import type { SteamInstaller } from '../../src/main/install/steam'
import { buildLaunchPlan, launcherOf, rockstarLaunchPlan } from '../../src/main/launch/plan'
import { RockstarWatcher, type RockstarStatus } from '../../src/main/launch/rockstar-watch'
import { GameRunner } from '../../src/main/launch/runner'
import { ALLOWED_HOSTS, type FetchLike } from '../../src/main/net/http'
import { parseTasklist } from '../../src/main/platform/processes'
import { parseRegQuery } from '../../src/main/platform/registry'
import { rockstarInstalls, rockstarSource, savesFolder } from '../../src/main/sources/rockstar'
import {
  isInsideFolder,
  launchRequests,
  parseRockstarLog,
  parseSize,
  pendingUpdateFolders,
  readRockstarLogs,
  readSessions,
  readTitleTable,
  readUpdateOutcomes
} from '../../src/main/sources/rockstar-log'
import { mayUninstall, uninstallPlan } from '../../src/main/sources/uninstall'
import { rockstarTitle, rockstarTitleByTag } from '../../src/shared/rockstar'
import { installHint, installPhaseLabel } from '../../src/shared/install'
import { apiFixture, fakeFetch, FIXTURES, json, MIGRATIONS } from './helpers'

const ROOT = join(FIXTURES, 'rockstar')
const LOGS = join(ROOT, 'logs')
const registryKeys = () => parseRegQuery(readFileSync(join(ROOT, 'registry.txt'), 'utf8'))
const at = (d: number, h: number, mi: number, s = 0) => new Date(2026, 10, d, h, mi, s).getTime()
const GTA = 'C:\\Program Files\\Rockstar Games\\Grand Theft Auto V'
const RDR2 = 'D:\\Jeux\\Red Dead Redemption 2'

describe('Rockstar catalogue', () => {
  it('maps title ids and Social Club tags to games', () => {
    expect(rockstarTitle('GTA5')?.steamAppId).toBe('271590')
    expect(rockstarTitleByTag('rdr2_pc')?.titleId).toBe('rdr2')
    expect(rockstarTitleByTag('UNKNOWN_PC')).toBeNull()
  })

  it('gives the Steam appid of catalogue games for the game page', () => {
    expect(defaultSteamAppId({ source: 'rockstar', sourceId: 'rdr2' })).toBe('1174180')
    expect(defaultSteamAppId({ source: 'rockstar', sourceId: 'nope' })).toBeNull()
    expect(defaultSteamAppId({ source: 'steam', sourceId: '10' })).toBe('10')
    expect(defaultSteamAppId({ source: 'gog', sourceId: '10' })).toBeNull()
  })

  it('puts the rockstargames.com page first in the links', () => {
    const links = withRockstarLink('rdr2', [
      { kind: 'steam', label: 'Page Steam', url: 'https://store.steampowered.com/app/1174180' }
    ])
    expect(links[0]).toEqual({
      kind: 'official',
      label: 'Rockstar Games',
      url: 'https://www.rockstargames.com/fr/games/reddeadredemption2'
    })
    expect(links).toHaveLength(2)
    expect(withRockstarLink('gta3', [])).toEqual([])
  })
})

describe('Rockstar detection', () => {
  it('reads the uninstall entries the launcher writes, without the launcher itself', () => {
    expect(rockstarInstalls(registryKeys())).toEqual([
      {
        titleId: 'gta5',
        title: 'Grand Theft Auto V Legacy',
        installPath: GTA,
        version: '1.0.3351.0'
      },
      {
        titleId: 'rdr2',
        title: 'Red Dead Redemption 2',
        installPath: RDR2,
        version: '1.0.1491.50'
      }
    ])
  })

  it('scans installed games, pending updates from the log and saves folders', async () => {
    const source = rockstarSource(() => ({
      uninstallKeys: async () => registryKeys(),
      launcher: async () => null,
      logDir: LOGS,
      savesDir: join(ROOT, 'Documents')
    }))
    const found = await source.scan()
    expect(found.map((g) => [g.sourceId, g.updateAvailable, g.executablePath])).toEqual([
      ['gta5', true, null],
      ['rdr2', false, null]
    ])
    expect(found[0]!.savePath).toBe(join(ROOT, 'Documents', 'GTA V', 'Profiles'))
    expect(found[1]!.savePath).toBeNull()
    expect(await source.locate()).toBe('Registre Windows')
  })

  it('finds nothing without the launcher', async () => {
    const source = rockstarSource(() => ({
      uninstallKeys: async () => [],
      launcher: async () => null,
      logDir: '',
      savesDir: ''
    }))
    expect(await source.scan()).toEqual([])
    expect(await source.locate()).toBeNull()
    expect(savesFolder('', 'gta5')).toBeNull()
  })
})

describe('Rockstar launcher log', () => {
  it('parses lines with their local time, thread and category', () => {
    const [entry] = parseRockstarLog(
      '[2026-11-20 18:01:10.250] [DISPLAY] [31337] [gamelaunch] Launching game...\r\nnoise'
    )
    expect(entry).toEqual({
      time: new Date(2026, 10, 20, 18, 1, 10, 250).getTime(),
      thread: '31337',
      category: 'gamelaunch',
      message: 'Launching game...'
    })
  })

  it('pairs each game start with its exit on the same thread, across log files', async () => {
    const sessions = readSessions(await readRockstarLogs(LOGS))
    expect(sessions).toEqual([
      { path: `${GTA}\\GTA5_BE.exe`, startedAt: at(18, 21, 0), endedAt: at(18, 22, 30) },
      { path: `${GTA}\\GTA5_BE.exe`, startedAt: at(18, 22, 31), endedAt: at(18, 22, 31, 10) },
      // Left open when the launcher restarted: never exited cleanly.
      { path: `${GTA}\\GTA5.exe`, startedAt: at(18, 23, 0), endedAt: null },
      { path: `${RDR2}\\RDR2.exe`, startedAt: at(20, 18, 1, 10), endedAt: at(20, 19, 31, 10) },
      { path: `${GTA}\\GTA5.exe`, startedAt: at(20, 20, 0, 5), endedAt: null }
    ])
  })

  it('reads the installed titles table and pending updates', async () => {
    const current = await readRockstarLogs(LOGS, 1)
    const table = readTitleTable(current)
    expect(table?.rows).toMatchObject([
      {
        name: 'Grand Theft Auto V Legacy',
        progress: '131.84 Mo / 5.37 Go',
        version: '1.0.3351.0',
        location: GTA,
        pending: true,
        totalBytes: Math.round(5.37 * 1024 ** 3)
      },
      { name: 'Red Dead Redemption 2', pending: false, downloadedBytes: null, location: RDR2 }
    ])
    expect(pendingUpdateFolders(current)).toEqual([GTA])
    expect(launchRequests(current, at(20, 18, 0))).toEqual(['rdr2', 'gta5'])
    expect(launchRequests(current, at(20, 19, 0))).toEqual(['gta5'])
  })

  it('drops an update finished after the table', async () => {
    const older = parseRockstarLog(readFileSync(join(LOGS, 'launcher.01.log'), 'latin1'))
    expect(readUpdateOutcomes(older).get('grand theft auto v')?.outcome).toBe('succeeded')
    const pendingThenDone = parseRockstarLog(
      [
        '[2026-11-21 10:00:00.000] [DISPLAY] [Main ] [titlestorage] Installed titles:',
        '[2026-11-21 10:00:00.000] [DISPLAY] [Main ] [titlestorage]  Title                             Progress               Version              Location',
        '[2026-11-21 10:00:00.000] [DISPLAY] [Main ] [titlestorage]  Max Payne 3                       1.2 GB / 3 GB          1.0.0.255            E:\\MP3',
        '[2026-11-21 10:20:00.000] [DISPLAY] [Workr] [titleupdater] Update of Max Payne 3 succeeded.'
      ].join('\n')
    )
    expect(readTitleTable(pendingThenDone)?.rows[0]?.downloadedBytes).toBe(
      Math.round(1.2 * 1024 ** 3)
    )
    expect(pendingUpdateFolders(pendingThenDone)).toEqual([])
  })

  it('parses localized sizes and Windows folders', () => {
    expect(parseSize('5.37 Go')).toBe(Math.round(5.37 * 1024 ** 3))
    expect(parseSize('131,84 MB')).toBe(Math.round(131.84 * 1024 ** 2))
    expect(parseSize('Up-to-date')).toBeNull()
    expect(
      isInsideFolder(
        'c:/program files/rockstar games/gta v/gta5.exe',
        'C:\\Program Files\\Rockstar Games\\GTA V\\'
      )
    ).toBe(true)
    expect(isInsideFolder('C:\\Games\\GTA Vice\\x.exe', 'C:\\Games\\GTA V')).toBe(false)
  })
})

describe('Rockstar launch', () => {
  const target = {
    source: 'rockstar' as const,
    sourceId: 'gta5',
    executablePath: null,
    launchArgs: null,
    useRunner: false
  }
  const options = { platform: 'win32' as const, runnerPath: null, protonPrefix: '/p' }

  it('starts the game through Launcher.exe in min mode', () => {
    expect(
      buildLaunchPlan(target, { ...options, rockstarLauncher: 'C:\\RGL\\Launcher.exe' })
    ).toEqual({ kind: 'launcher', command: 'C:\\RGL\\Launcher.exe', args: ['-minmodeApp=gta5'] })
    // Even with an executable set: the launcher handles DRM and Social Club.
    expect(
      buildLaunchPlan(
        { ...target, executablePath: 'C:\\GTA\\GTA5.exe' },
        { ...options, rockstarLauncher: 'C:\\RGL\\Launcher.exe' }
      ).kind
    ).toBe('launcher')
    expect(launcherOf({ source: 'rockstar', executablePath: 'x.exe' })).toBe('rockstar')
  })

  it('explains a missing launcher and refuses odd title ids', () => {
    expect(() => buildLaunchPlan(target, options)).toThrow(/Rockstar Games Launcher introuvable/)
    expect(() => rockstarLaunchPlan('gta5 -evil', 'C:\\Launcher.exe')).toThrow(/invalide/)
  })

  it('reports a launcher that cannot start (no URI to fall back to)', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => {}
      setTimeout(() => child.emit('error', new Error('EACCES')), 0)
      return child
    })
    const runner = new GameRunner({
      spawn: spawn as never,
      openExternal: vi.fn(),
      onStart: () => 1,
      onExit: () => {}
    })
    await expect(
      runner.launch(1, { kind: 'launcher', command: 'Launcher.exe', args: ['-minmodeApp=gta5'] })
    ).rejects.toThrow(/Impossible de démarrer le launcher : EACCES/)
  })
})

describe('RockstarWatcher', () => {
  let now = 0
  let status: RockstarStatus
  let alive = true
  let watcher: RockstarWatcher

  beforeEach(() => {
    now = 1_000_000
    status = { openSessions: [], requested: [] }
    alive = true
    watcher = new RockstarWatcher({
      readStatus: async () => status,
      isRunning: async () => alive,
      startTimeoutMs: 60_000,
      now: () => now
    })
  })
  afterEach(() => watcher.dispose())

  it('follows a launch from the launcher starting to the game exiting', async () => {
    const events: string[] = []
    watcher.on('phase', (id, phase) => events.push(`${id}:${phase}`))
    watcher.on('change', (ids) => events.push(`running:${ids.join(',')}`))
    watcher.on('ended', (id) => events.push(`ended:${id}`))

    expect(watcher.watch(7, { titleId: 'gta5', installPath: GTA, executable: 'GTA5.exe' })).toBe(
      true
    )
    await watcher.poll()
    status = { openSessions: [], requested: ['gta5'] }
    await watcher.poll()
    status = { openSessions: [`${GTA}\\GTA5_BE.exe`], requested: ['gta5'] }
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([7])
    expect(watcher.watch(7, { titleId: 'gta5', installPath: GTA })).toBe(false)
    // Still logged as running, but the process is gone (launcher killed): ended.
    alive = false
    await watcher.poll()
    expect(events).toEqual(['7:launcher', '7:waiting', 'running:7', 'running:', 'ended:7'])
  })

  it('checks both the logged and the catalogue executable', async () => {
    const isRunning = vi.fn(async () => true)
    const w = new RockstarWatcher({
      readStatus: async () => ({ openSessions: [`${GTA}\\GTA5_BE.exe`], requested: [] }),
      isRunning
    })
    w.watch(1, { titleId: 'gta5', installPath: GTA, executable: 'GTA5.exe' })
    await w.poll()
    expect(isRunning).toHaveBeenCalledWith(['GTA5_BE.exe', 'GTA5.exe'])
    w.dispose()
  })

  it('gives up on a game that never starts', async () => {
    const expired: number[] = []
    watcher.on('expired', (id) => expired.push(id))
    watcher.watch(3, { titleId: 'rdr2', installPath: RDR2 })
    await watcher.poll()
    now += 61_000
    await watcher.poll()
    expect(expired).toEqual([3])
    expect(watcher.runningIds()).toEqual([])
  })

  it('stops waiting when the user cancels', async () => {
    watcher.watch(3, { titleId: 'rdr2', installPath: RDR2 })
    watcher.unwatch(3)
    status = { openSessions: [`${RDR2}\\RDR2.exe`], requested: [] }
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([])
  })
})

describe('Rockstar play sessions', () => {
  let handle: DatabaseHandle
  let gta: number
  let rdr2: number

  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    const insert = (sourceId: string, installPath: string) =>
      handle.db
        .insert(games)
        .values({ title: sourceId, source: 'rockstar', sourceId, installPath })
        .returning()
        .get().id
    gta = insert('gta5', GTA)
    rdr2 = insert('rdr2', 'E:\\Moved\\RDR2')
  })
  afterEach(() => handle.close())

  it('imports finished runs once, skipping crashes and runs already measured', async () => {
    const sessions = readSessions(await readRockstarLogs(LOGS))
    // Measured by Shelf already (overlaps the first GTA run).
    handle.db
      .insert(playSessions)
      .values({
        gameId: gta,
        startedAt: new Date(at(18, 21, 1)),
        endedAt: new Date(at(18, 22, 29)),
        durationSec: 5280
      })
      .run()
    expect(importRockstarSessions(handle.db, sessions)).toBe(1)
    expect(importRockstarSessions(handle.db, sessions)).toBe(0)
    const rows = handle.db.select().from(playSessions).where(eq(playSessions.gameId, rdr2)).all()
    // Matched by executable name: the game moved since.
    expect(rows).toEqual([
      expect.objectContaining({ durationSec: 90 * 60, startedAt: new Date(at(20, 18, 1, 10)) })
    ])
  })
})

describe('Rockstar install, uninstall, update', () => {
  it('builds Launcher.exe arguments', () => {
    expect(rockstarArgs('install', 'rdr2')).toEqual(['-enableFullMode', '-install=rdr2'])
    expect(rockstarArgs('uninstall', 'gta5')).toEqual(['-enableFullMode', '-uninstall=gta5'])
    expect(rockstarArgs('open')).toEqual([])
    expect(() => rockstarArgs('install', '../x')).toThrow(/invalide/)
  })

  it('runs the launcher detached, or explains it is missing', async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = vi.fn()
    const spawn = vi.fn(() => {
      setTimeout(() => child.emit('spawn'), 0)
      return child
    })
    const launcher = new RockstarLauncher({
      launcher: async () => 'C:\\RGL\\Launcher.exe',
      uninstallKeys: async () => [],
      logDir: () => LOGS,
      spawn: spawn as never
    })
    await launcher.run('uninstall', 'gta5')
    expect(spawn).toHaveBeenCalledWith(
      'C:\\RGL\\Launcher.exe',
      ['-enableFullMode', '-uninstall=gta5'],
      expect.objectContaining({ detached: true })
    )
    const missing = new RockstarLauncher({
      launcher: async () => null,
      uninstallKeys: async () => [],
      logDir: () => ''
    })
    await expect(missing.run('open')).rejects.toThrow(/introuvable/)
  })

  it('tells an install done once the launcher logs its success', async () => {
    const launcher = new RockstarLauncher({
      launcher: async () => null,
      uninstallKeys: async () => registryKeys(),
      logDir: () => join(LOGS, '..', 'logs'),
      exists: () => true
    })
    // gta5's update succeeded in launcher.01.log, not in the current log: still pending.
    expect(await launcher.state('gta5', 'Grand Theft Auto V', at(20, 17, 0))).toMatchObject({
      installed: false,
      outcome: null,
      totalBytes: Math.round(5.37 * 1024 ** 3)
    })
    expect(await launcher.state('rdr2', 'Red Dead Redemption 2', at(21, 0, 0))).toMatchObject({
      installed: false,
      totalBytes: null
    })
  })

  it('uninstalls through the launcher on Windows only', () => {
    const game = { source: 'rockstar' as const, sourceId: 'gta5', installPath: GTA }
    expect(uninstallPlan(game, 'win32')).toEqual({ kind: 'rockstar', titleId: 'gta5' })
    expect(mayUninstall(game, 'linux')).toBe(false)
    expect(uninstallPlan(game, 'linux')).toBeNull()
  })
})

describe('InstallService with the Rockstar Games Launcher', () => {
  const rdr2: InstallTarget = {
    id: 9,
    title: 'Red Dead Redemption 2',
    source: 'rockstar',
    sourceId: 'rdr2'
  }

  function setup(states: Awaited<ReturnType<RockstarLauncher['state']>>[]) {
    const rockstar = {
      run: vi.fn(async () => {}),
      state: vi.fn(async () => states.shift() ?? states[states.length - 1]!)
    }
    const deps = {
      steam: Object.assign(new EventEmitter(), { dispose: vi.fn() }) as unknown as SteamInstaller,
      legendary: { dispose: vi.fn() } as unknown as LegendaryInstaller,
      rockstar: rockstar as unknown as RockstarLauncher,
      rockstarPollMs: 60_000,
      enabled: () => true,
      defaultPath: () => null,
      openExternal: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      onChange: vi.fn(),
      onEnded: vi.fn()
    }
    return { installs: new InstallService(deps), deps, rockstar }
  }
  const state = (patch: object) => ({
    installed: false,
    outcome: null,
    downloadedBytes: null,
    totalBytes: null,
    ...patch
  })

  it('opens the launcher on the install and follows it to the end', async () => {
    const { installs, deps, rockstar } = setup([
      state({ downloadedBytes: 1024, totalBytes: 4096 }),
      state({ outcome: 'paused', downloadedBytes: 2048, totalBytes: 4096 }),
      state({ installed: true, outcome: 'succeeded' })
    ])
    expect(await installs.install(rdr2)).toEqual({ mode: 'followed' })
    expect(rockstar.run).toHaveBeenCalledWith('install', 'rdr2')
    expect(installs.list()[0]).toMatchObject({ phase: 'queued', cancellable: true })
    const poll = () => (installs as unknown as { pollRockstar(): Promise<void> }).pollRockstar()
    await poll()
    expect(installs.list()[0]).toMatchObject({ phase: 'downloading', progress: 0.25 })
    await poll()
    expect(installs.list()[0]).toMatchObject({ phase: 'paused', progress: 0.5 })
    await poll()
    expect(deps.refresh).toHaveBeenCalled()
    expect(deps.onEnded).toHaveBeenCalledWith(rdr2, 'installed', undefined)
    expect(installs.list()).toEqual([])
    installs.dispose()
  })

  it('stops following on cancel and reports a failure', async () => {
    const { installs, deps } = setup([state({ outcome: 'failed' })])
    await installs.install(rdr2)
    await installs.cancel(rdr2.id)
    expect(deps.onEnded).toHaveBeenCalledWith(
      rdr2,
      'cancelled',
      expect.stringMatching(/continue dans le Rockstar Games Launcher/)
    )
    await installs.install(rdr2)
    await (installs as unknown as { pollRockstar(): Promise<void> }).pollRockstar()
    expect(deps.onEnded).toHaveBeenLastCalledWith(rdr2, 'failed', expect.stringMatching(/échec/))
    installs.dispose()
  })

  it('words the install for the Rockstar launcher', () => {
    const progress = { source: 'rockstar' as const, phase: 'queued' as const, progress: null }
    expect(installPhaseLabel(progress)).toBe('Installation dans le launcher Rockstar…')
    expect(installHint({ ...progress, startedAt: 0 }, 0)).toMatch(/fenêtre du launcher Rockstar/)
    expect(installPhaseLabel({ ...progress, phase: 'paused' })).toBe(
      'En pause dans le launcher Rockstar'
    )
  })
})

describe('Rockstar Games Social Club account', () => {
  const session: SocialClubSession = {
    userAgent: 'Mozilla/5.0 Shelf-test',
    cookies: [
      { name: 'BearerToken', value: 'web', domain: 'www.rockstargames.com', path: '/' },
      { name: 'BearerToken', value: 'sc', domain: '.socialclub.rockstargames.com', path: '/' },
      { name: 'prod', value: 'sc-session', domain: 'socialclub.rockstargames.com', path: '/' }
    ]
  }
  const setup = () => json(apiFixture('socialclub-setup-data.json'))
  const unauthorized = () => new Response('', { status: 401 })
  // What the website's former route answers now, signed in (2026-11-22).
  const notAllowed = () =>
    json(
      {
        Status: false,
        EmailVerified: true,
        ProfileHidden: false,
        WallHidden: false,
        NotAllowed: true
      },
      403
    )
  const basic = () => json(apiFixture('scapi-basicprofile.json'))
  const profile = () => json(apiFixture('scapi-getprofile.json'))
  const profileRoutes: [string, () => Response][] = [
    ['profile/getbasicprofile', basic],
    ['profile/getprofile', profile]
  ]
  const access = (fetch: FetchLike, cookies = session.cookies): SocialClubAccess => ({
    fetch,
    authCheck: vi.fn(async () => {}),
    cookies: async () => cookies
  })

  /** Browser stand-in: the login probe runs once, `use` hands the session back renewed. */
  function fakeBrowser(fetch: FetchLike) {
    const shared = access(fetch)
    const browser: SocialClubBrowser = {
      login: async (probe) => ({ session, result: await probe(shared) }),
      use: async (saved, fn) => ({
        session: {
          ...saved,
          cookies: [
            ...saved.cookies,
            { name: 'renewed', value: '1', domain: '.rockstargames.com', path: '/' }
          ]
        },
        result: await fn(shared)
      })
    }
    return { browser, authCheck: shared.authCheck }
  }

  it('only talks to the Social Club hosts it needs', () => {
    expect(ALLOWED_HOSTS.has('socialclub.rockstargames.com')).toBe(true)
    expect(ALLOWED_HOSTS.has('scapi.rockstargames.com')).toBe(true)
    expect(ALLOWED_HOSTS.has('signin.rockstargames.com')).toBe(false)
  })

  it('reads the owned PC games of the catalogue', () => {
    expect(
      parseGamesOwned(apiFixture('socialclub-setup-data.json') as never).map((g) => g.sourceId)
    ).toEqual(['gta5', 'rdr2', 'mp3'])
    expect(parseGamesOwned({ gamesOwned: ['LAN_PC', 'Launcher_PC'] })).toEqual([
      { source: 'rockstar', sourceId: 'lanoire', title: 'L.A. Noire' }
    ])
    expect(
      profileTags([
        'GTAV_PC',
        { name: 'RDR2', platform: 'PCROS' },
        { name: 'GTAV', platform: 'PS4' },
        { platform: 'PC' }
      ])
    ).toEqual(['GTAV_PC', 'RDR2_PC', 'GTAV_PS4'])
  })

  it('reads the games from the Social Club profile with its bearer token', async () => {
    const fetch = fakeFetch(profileRoutes)
    const games = await readOwned(access(fetch), 1)
    // PC only: the PS4 copy and the launcher are left out.
    expect(games.map((g) => g.sourceId)).toEqual(['gta5', 'rdr2'])
    const getprofile = fetch.calls.find((c) => c.url.includes('profile/getprofile?'))!
    expect(getprofile.url).toContain('nickname=PlayerOne')
    // Social Club's token, not the website's.
    expect((getprofile.init?.headers as Record<string, string>).Authorization).toBe('Bearer sc')
  })

  it('opens the Social Club session when it is not open yet, then reads the games', async () => {
    // No bearer token before AuthCheck, and the expired one is refused.
    let opened = false
    const cookies = () => (opened ? session.cookies : session.cookies.slice(2))
    const fetch = fakeFetch([
      ['profile/getbasicprofile', () => (opened ? basic() : unauthorized())],
      ['profile/getprofile', profile],
      ['getGoogleTagManagerSetupData', unauthorized]
    ])
    const authCheck = vi.fn(async () => {
      opened = true
    })
    const games = await readOwned({ fetch, authCheck, cookies: async () => cookies() }, 1)
    expect(games.map((g) => g.sourceId)).toEqual(['gta5', 'rdr2'])
    expect(authCheck).toHaveBeenCalledTimes(1)
  })

  it("falls back to the website's former route when the profile has no games", async () => {
    const fetch = fakeFetch([
      ['profile/getbasicprofile', basic],
      ['profile/getprofile', basic],
      ['getGoogleTagManagerSetupData', setup]
    ])
    const games = await readOwned(access(fetch), 1700000000000)
    expect(games.map((g) => g.sourceId)).toEqual(['gta5', 'rdr2', 'mp3'])
    const gtm = fetch.calls.find((c) => c.url.includes('getGoogleTagManagerSetupData'))!
    expect(gtm.url).toContain('_=1700000000000')
    expect((gtm.init?.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest')

    // Signed in, but no list anywhere: said as such, not "expired".
    const closed = fakeFetch([
      ['profile/getbasicprofile', basic],
      ['profile/getprofile', basic],
      ['getGoogleTagManagerSetupData', notAllowed]
    ])
    await expect(readOwned(access(closed), 1)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: expect.stringMatching(/ne fournit plus la liste/)
    })
  })

  it('does not open the session again when it is already open', async () => {
    const { browser, authCheck } = fakeBrowser(fakeFetch(profileRoutes))
    const provider = rockstarSocialProvider({ browser })
    const result = await provider.fetchOwned({ externalUserId: 'x' }, JSON.stringify(session))
    expect(result.games).toHaveLength(2)
    expect(authCheck).not.toHaveBeenCalled()
    // The renewed cookies are stored back.
    expect(parseSession(result.secret!).cookies.map((c) => c.name)).toContain('renewed')
  })

  it('connects through the login window with the nickname of the account', async () => {
    const provider = rockstarSocialProvider({
      browser: fakeBrowser(fakeFetch(profileRoutes)).browser
    })
    const connected = await provider.connect({})
    expect(connected).toMatchObject({ displayName: 'PlayerOne', externalUserId: '123456789' })
    expect(parseSession(connected.secret)).toEqual(session)
  })

  it('asks to reconnect when the session expired', async () => {
    const refused = (gtm: () => Response) =>
      rockstarSocialProvider({
        browser: fakeBrowser(
          fakeFetch([
            ['profile/getbasicprofile', unauthorized],
            ['getGoogleTagManagerSetupData', gtm]
          ])
        ).browser
      }).fetchOwned({ externalUserId: 'x' }, JSON.stringify(session))
    for (const gtm of [
      unauthorized,
      notAllowed,
      () => json(apiFixture('socialclub-setup-data-loggedout.json')),
      // A sign-in page instead of JSON.
      () => new Response('<html></html>')
    ]) {
      await expect(refused(gtm)).rejects.toMatchObject({
        code: 'AUTH',
        message: expect.stringMatching(/reconnectez/)
      })
    }
    const provider = rockstarSocialProvider({ browser: fakeBrowser(fakeFetch([])).browser })
    await expect(provider.fetchOwned({ externalUserId: 'x' }, null)).rejects.toThrow(/absente/)
  })
})

describe('process list', () => {
  it('reads image names from tasklist', () => {
    const names = parseTasklist(
      '"System Idle Process","0","Services","0","8 K"\r\n"GTA5.exe","4242","Console","1","1 200 000 K"\r\n'
    )
    expect(names.has('gta5.exe')).toBe(true)
    expect(names.has('rdr2.exe')).toBe(false)
  })
})
