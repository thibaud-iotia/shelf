import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import { parseRegQuery } from '../../src/main/platform/registry'
import { epicSource, parseEpicManifest, parseLegendaryInstalled } from '../../src/main/sources/epic'
import { exclusionReason, isInside, scanFolder } from '../../src/main/sources/folder-scan'
import {
  gamesFromHeroic,
  gamesFromRegistry,
  gogSource,
  parseGogInfo
} from '../../src/main/sources/gog'
import { itchSource, readButlerCaves } from '../../src/main/sources/itch'
import {
  isSteamTool,
  parseAppManifest,
  parseLibraryFolders,
  scanSteamRoot,
  steamSource
} from '../../src/main/sources/steam'
import { parseVdf } from '../../src/main/sources/vdf'

const fixtures = resolve(__dirname, '../fixtures')
const launchers = join(fixtures, 'launchers')
const read = (...parts: string[]) => readFileSync(join(fixtures, ...parts), 'utf8')

const tmp = mkdtempSync(join(tmpdir(), 'shelf-sources-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('VDF parser', () => {
  it('parses nested objects, escapes and comments; keys are lower-cased', () => {
    const vdf = parseVdf(`
      "Root" {
        // comment
        "Path"  "C:\\\\Games\\\\Steam"
        "quote" "say \\"hi\\""
        "Child" { "a" "1" }
      }`)
    expect(vdf).toEqual({
      root: { path: 'C:\\Games\\Steam', quote: 'say "hi"', child: { a: '1' } }
    })
  })

  it('rejects unbalanced input', () => {
    expect(() => parseVdf('"a" {')).toThrow(/end of file/)
    expect(() => parseVdf('}')).toThrow(/unbalanced/)
  })
})

describe('Steam', () => {
  it('reads library folders in both formats', () => {
    expect(parseLibraryFolders(read('launchers/steam/steamapps/libraryfolders.vdf'))).toEqual([
      'C:\\shelf-does-not-exist\\SteamLibrary'
    ])
    expect(
      parseLibraryFolders('"LibraryFolders" { "TimeNextStatsReport" "1" "1" "D:\\\\SteamLibrary" }')
    ).toEqual(['D:\\SteamLibrary'])
  })

  it('reads app manifests and the installed flag', () => {
    expect(parseAppManifest(read('launchers/steam/steamapps/appmanifest_1145360.acf'))).toEqual({
      appId: '1145360',
      name: 'Hades',
      installDir: 'Hades',
      installed: true
    })
    expect(
      parseAppManifest(read('launchers/steam/steamapps/appmanifest_413150.acf'))?.installed
    ).toBe(false)
    expect(
      isSteamTool(parseAppManifest(read('launchers/steam/steamapps/appmanifest_228980.acf'))!)
    ).toBe(true)
  })

  it('scans a Steam root: installed games only, no tools', async () => {
    const root = join(launchers, 'steam')
    const games = await scanSteamRoot(root)
    expect(games.map((g) => g.title).sort()).toEqual(['Hades', 'Hollow Knight'])
    expect(games.find((g) => g.sourceId === '1145360')?.installPath).toBe(
      join(root, 'steamapps', 'common', 'Hades')
    )
    const source = steamSource(async () => [join(tmp, 'nope'), root])
    expect(await source.locate()).toBe(root)
  })
})

describe('Epic', () => {
  it('keeps installed games, skips DLCs and engines', async () => {
    const source = epicSource(() => ({
      manifestDirs: [join(launchers, 'epic', 'Manifests')],
      legendaryInstalled: []
    }))
    const games = await source.scan()
    expect(games).toEqual([
      {
        source: 'epic',
        sourceId: 'Salt',
        title: 'Celeste',
        installPath: 'C:\\Program Files\\Epic Games\\Celeste',
        executablePath: join('C:\\Program Files\\Epic Games\\Celeste', 'Celeste.exe')
      }
    ])
    expect(
      parseEpicManifest({
        DisplayName: 'X',
        AppName: 'x',
        InstallLocation: 'C:\\x',
        bIsIncompleteInstall: true
      })
    ).toBeNull()
  })

  it('reads Legendary / Heroic installed.json', () => {
    expect(
      parseLegendaryInstalled({
        Fortnite: {
          app_name: 'Fortnite',
          title: 'Fortnite',
          install_path: '/games/Fortnite',
          executable: 'FortniteLauncher'
        },
        Dlc: { title: 'Some DLC', install_path: '/games/dlc', is_dlc: true }
      })
    ).toEqual([
      {
        source: 'epic',
        sourceId: 'Fortnite',
        title: 'Fortnite',
        installPath: '/games/Fortnite',
        executablePath: join('/games/Fortnite', 'FortniteLauncher')
      }
    ])
  })
})

describe('GOG', () => {
  it('parses `reg query` output and drops DLCs', () => {
    const keys = parseRegQuery(read('registry', 'gog-reg-query.txt'))
    expect(keys).toHaveLength(2)
    expect(keys[0]?.values).toMatchObject({ gamename: 'Unreal Tournament 2004', dependson: '' })
    expect(gamesFromRegistry(keys)).toEqual([
      {
        source: 'gog',
        sourceId: '1207658924',
        title: 'Unreal Tournament 2004',
        installPath: 'C:\\GOG Games\\UT2004',
        executablePath: 'C:\\GOG Games\\UT2004\\System\\UT2004.exe'
      }
    ])
  })

  it('reads goggame-*.info and its primary play task', () => {
    const folder = join(launchers, 'gog', 'Disco Elysium')
    const info = JSON.parse(read('launchers', 'gog', 'Disco Elysium', 'goggame-1771589310.info'))
    expect(parseGogInfo(info, folder)).toEqual({
      source: 'gog',
      sourceId: '1771589310',
      title: 'Disco Elysium',
      installPath: folder,
      executablePath: join(folder, 'disco.exe')
    })
    expect(parseGogInfo({ ...info, rootGameId: '1' }, folder)).toBeNull()
  })

  it('combines registry, game folders and Heroic', async () => {
    const heroicFile = join(tmp, 'gog-installed.json')
    writeFileSync(
      heroicFile,
      JSON.stringify({
        installed: [
          { appName: '1771589310', install_path: join(launchers, 'gog', 'Disco Elysium') },
          { appName: '42', install_path: '/games/Unknown Game' },
          { appName: '43', install_path: '/games/dlc', is_dlc: true }
        ]
      })
    )
    const fromHeroic = await gamesFromHeroic(JSON.parse(readFileSync(heroicFile, 'utf8')))
    expect(fromHeroic.map((g) => g.title)).toEqual(['Disco Elysium', 'Unknown Game'])

    const source = gogSource(() => ({
      registry: async () => parseRegQuery(read('registry', 'gog-reg-query.txt')),
      gameDirs: [join(launchers, 'gog')],
      heroicInstalled: [heroicFile]
    }))
    expect((await source.scan()).map((g) => g.sourceId).sort()).toEqual([
      '1207658924',
      '1771589310',
      '42'
    ])
    expect(await source.locate()).toBe('Registre Windows (GOG.com)')
  })
})

describe('itch.io', () => {
  it('reads installed caves from butler.db', async () => {
    const file = join(tmp, 'butler.db')
    const db = new Database(file)
    db.exec(`
      CREATE TABLE games (id INTEGER PRIMARY KEY, title TEXT);
      CREATE TABLE install_locations (id TEXT PRIMARY KEY, path TEXT);
      CREATE TABLE caves (id TEXT PRIMARY KEY, game_id INTEGER, verdict TEXT, install_folder_name TEXT, install_location_id TEXT);
      INSERT INTO games VALUES (1, 'Baba Is You'), (2, 'Celeste Classic');
      INSERT INTO install_locations VALUES ('loc', '/home/me/itch');
      INSERT INTO caves VALUES ('c1', 1, '{"basePath":"/home/me/itch/baba","candidates":[{"path":"Baba Is You.x86_64","flavor":"linux"}]}', 'baba', 'loc');
      INSERT INTO caves VALUES ('c2', 2, NULL, 'celeste-classic', 'loc');
    `)
    db.close()

    expect(readButlerCaves(file)).toEqual([
      {
        source: 'itch',
        sourceId: '1',
        title: 'Baba Is You',
        installPath: '/home/me/itch/baba',
        executablePath: join('/home/me/itch/baba', 'Baba Is You.x86_64')
      },
      {
        source: 'itch',
        sourceId: '2',
        title: 'Celeste Classic',
        installPath: join('/home/me/itch', 'celeste-classic'),
        executablePath: null
      }
    ])
    const source = itchSource(() => [join(tmp, 'missing.db'), file])
    expect(await source.locate()).toBe(file)
    expect(await itchSource(() => []).scan()).toEqual([])
  })
})

describe('folder scan', () => {
  it('flags non-game executables', () => {
    expect(exclusionReason('unins000.exe')).toBe('uninstall')
    expect(exclusionReason('setup.exe')).toBe('installateur')
    expect(exclusionReason('vcredist_x64.exe')).toBe('redistribuable')
    expect(exclusionReason('UnityCrashHandler64.exe')).toBe('crash reporter')
    expect(exclusionReason('Hollow.exe')).toBeNull()
    expect(exclusionReason('Hollow-benchmark.exe', ['bench'])).toBe('exclusion personnalisée')
  })

  it('picks one executable per game folder', async () => {
    const root = join(fixtures, 'folders', 'Games')
    const findings = await scanFolder(root, [], 'win32')
    const main = findings.filter((f) => !f.excludedReason).map((f) => [f.title, f.path])
    expect(main).toEqual(
      expect.arrayContaining([
        ['Hollow', join(root, 'Hollow', 'Hollow.exe')],
        ['Celeste', join(root, 'Celeste', 'Celeste.exe')],
        ['Doom', join(root, 'Doom', 'game_x64.exe')],
        ['Retro Pack', join(root, 'RetroPack', 'bin', 'RetroPack.exe')]
      ])
    )
    expect(main).toHaveLength(4)
    const excluded = findings.filter((f) => f.excludedReason).map((f) => f.excludedReason)
    expect(excluded.sort()).toEqual(['crash reporter', 'installateur', 'uninstall'])
  })

  it('compares paths', () => {
    expect(isInside(join(tmp, 'a', 'b.exe'), join(tmp, 'a'))).toBe(true)
    expect(isInside(join(tmp, 'ab', 'b.exe'), join(tmp, 'a'))).toBe(false)
  })

  it('ignores missing folders', async () => {
    mkdirSync(join(tmp, 'empty'), { recursive: true })
    expect(await scanFolder(join(tmp, 'empty'))).toEqual([])
    expect(await scanFolder(join(tmp, 'missing'))).toEqual([])
  })
})
