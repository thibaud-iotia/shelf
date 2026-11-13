// All filesystem locations used by the app live here. No hard-coded path anywhere else.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { LegendaryBinary } from '../accounts/epic-legendary'
import { readSteamStatusFromVdf, toSteamStatus, type SteamStatus } from '../sources/steam-running'
import { queryRegistry, queryRegistryValue } from './registry'

/**
 * Lets e2e tests (and power users) isolate data in a throwaway directory.
 * Must run before `app.whenReady()`.
 */
export function applyUserDataOverride(): void {
  const override = process.env.SHELF_USER_DATA
  if (override) app.setPath('userData', override)
}

const resources = (...parts: string[]): string =>
  app.isPackaged ? join(process.resourcesPath, ...parts) : join(__dirname, '../..', ...parts)

export const paths = {
  userData: (): string => app.getPath('userData'),
  database: (): string => join(app.getPath('userData'), 'shelf.db'),
  covers: (): string => join(app.getPath('userData'), 'covers'),
  /** Encrypted secrets (safeStorage blobs), never stored in the DB. */
  secrets: (): string => join(app.getPath('userData'), 'secrets.json'),
  // Wine prefix handed to Proton for non-Steam .exe games (Linux).
  protonPrefix: (): string => join(app.getPath('userData'), 'proton-prefix'),
  // Packaged: copied via electron-builder extraResources. Dev/e2e: repo root, relative to out/main.
  migrations: (): string => resources('drizzle'),
  trayIcon: (): string =>
    resources('resources', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'),
  appIcon: (): string => resources('resources', 'icon.png'),
  /** Linux autostart entry (XDG). */
  autostartEntry: (): string =>
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart', 'shelf.desktop'),
  preload: (): string => join(__dirname, '../preload/index.js'),
  rendererHtml: (): string => join(__dirname, '../renderer/index.html')
}

/** Where each launcher keeps its data. See `launcherLocations()`. */
export interface LauncherLocations {
  steamRoots: () => Promise<string[]>
  /** Steam's RunningAppID, client process and update flags of `appIds` (games being launched). */
  steamStatus: (appIds: number[]) => Promise<SteamStatus>
  /** Steam client executable, used to start games with Steam minimized (`-silent`). Null: use the URI. */
  steamExecutable: () => Promise<string | null>
  epicManifestDirs: string[]
  /** Legendary / Heroic `installed.json` files (Epic on Linux and macOS). */
  legendaryInstalled: string[]
  /** Candidate Legendary executables; `legendary` alone means "on PATH". Heroic's copy uses its config. */
  legendaryBinaries: LegendaryBinary[]
  /** Reads GOG's Windows registry entries; empty elsewhere. */
  gogRegistry: () => ReturnType<typeof queryRegistry>
  gogGameDirs: string[]
  heroicGogInstalled: string[]
  itchDatabases: string[]
  galaxyDatabases: string[]
}

/** Fixture layout used when SHELF_LAUNCHER_ROOT is set (e2e): one sub-folder per launcher. */
function fixtureLocations(root: string): LauncherLocations {
  return {
    steamRoots: async () => [join(root, 'steam')],
    steamStatus: (appIds) => readSteamStatusFromVdf([join(root, 'steam', 'registry.vdf')], appIds),
    steamExecutable: async () => null,
    epicManifestDirs: [join(root, 'epic', 'Manifests')],
    legendaryInstalled: [join(root, 'legendary', 'installed.json')],
    legendaryBinaries: [],
    gogRegistry: async () => [],
    gogGameDirs: [join(root, 'gog')],
    heroicGogInstalled: [join(root, 'heroic', 'gog_store', 'installed.json')],
    itchDatabases: [join(root, 'itch', 'butler.db')],
    galaxyDatabases: [join(root, 'galaxy', 'galaxy-2.0.db')]
  }
}

async function steamRootFromRegistry(): Promise<string[]> {
  const [key] = await queryRegistry('HKCU\\Software\\Valve\\Steam')
  const path = key?.values.steampath
  return path ? [path.replace(/\//g, '\\')] : []
}

const STEAM_KEY = 'HKCU\\Software\\Valve\\Steam'

/** Windows: the client pid and update flags are only read while a launch is pending. */
async function steamStatusFromRegistry(appIds: number[]): Promise<SteamStatus> {
  const value = async (key: string, name: string) =>
    (await queryRegistryValue(key, name)) ?? undefined
  const [runningAppId, pid, ...updating] = await Promise.all([
    value(STEAM_KEY, 'RunningAppID'),
    appIds.length ? value(`${STEAM_KEY}\\ActiveProcess`, 'pid') : undefined,
    ...appIds.map((id) => value(`${STEAM_KEY}\\Apps\\${id}`, 'Updating'))
  ])
  return toSteamStatus({
    runningAppId,
    pid,
    updating: Object.fromEntries(appIds.map((id, i) => [id, updating[i]]))
  })
}

export function launcherLocations(): LauncherLocations {
  const override = process.env.SHELF_LAUNCHER_ROOT
  if (override) return fixtureLocations(override)

  const home = homedir()
  const env = process.env

  if (process.platform === 'win32') {
    const programData = env.ProgramData ?? 'C:\\ProgramData'
    const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return {
      steamRoots: async () => [
        ...(await steamRootFromRegistry()),
        join(programFilesX86, 'Steam'),
        join(programFiles, 'Steam')
      ],
      steamStatus: steamStatusFromRegistry,
      steamExecutable: async () => {
        const registered = await queryRegistryValue(STEAM_KEY, 'SteamExe')
        const candidates = [
          ...(registered ? [registered.replace(/\//g, '\\')] : []),
          join(programFilesX86, 'Steam', 'steam.exe'),
          join(programFiles, 'Steam', 'steam.exe')
        ]
        return candidates.find((file) => existsSync(file)) ?? null
      },
      epicManifestDirs: [join(programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')],
      legendaryInstalled: [
        join(appData, 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
        join(home, '.config', 'legendary', 'installed.json')
      ],
      legendaryBinaries: [
        {
          file: 'legendary',
          installedFile: join(home, '.config', 'legendary', 'installed.json'),
          defaultInstallDir: join(home, 'Games')
        },
        {
          file: join(
            localAppData,
            'Programs',
            'heroic',
            'resources',
            'app.asar.unpacked',
            'build',
            'bin',
            'x64',
            'win32',
            'legendary.exe'
          ),
          configPath: join(appData, 'heroic', 'legendaryConfig', 'legendary'),
          installedFile: join(appData, 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
          heroicConfig: join(appData, 'heroic', 'config.json'),
          defaultInstallDir: join(home, 'Games', 'Heroic')
        }
      ],
      gogRegistry: () => queryRegistry('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'),
      gogGameDirs: [join(programFilesX86, 'GOG Galaxy', 'Games'), 'C:\\GOG Games'],
      heroicGogInstalled: [join(appData, 'heroic', 'gog_store', 'installed.json')],
      itchDatabases: [join(appData, 'itch', 'db', 'butler.db')],
      galaxyDatabases: [join(programData, 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db')]
    }
  }

  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return {
      steamRoots: async () => [join(support, 'Steam')],
      steamStatus: (appIds) =>
        readSteamStatusFromVdf([join(support, 'Steam', 'registry.vdf')], appIds),
      steamExecutable: async () => null,
      epicManifestDirs: [join(support, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')],
      legendaryInstalled: [
        join(support, 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
        join(home, '.config', 'legendary', 'installed.json')
      ],
      legendaryBinaries: [
        {
          file: 'legendary',
          installedFile: join(home, '.config', 'legendary', 'installed.json'),
          defaultInstallDir: join(home, 'Games')
        },
        ...['arm64', 'x64'].map((arch) => ({
          file: `/Applications/Heroic.app/Contents/Resources/app.asar.unpacked/build/bin/${arch}/darwin/legendary`,
          configPath: join(support, 'heroic', 'legendaryConfig', 'legendary'),
          installedFile: join(support, 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
          heroicConfig: join(support, 'heroic', 'config.json'),
          defaultInstallDir: join(home, 'Games', 'Heroic')
        }))
      ],
      gogRegistry: async () => [],
      gogGameDirs: [],
      heroicGogInstalled: [join(support, 'heroic', 'gog_store', 'installed.json')],
      itchDatabases: [join(support, 'itch', 'db', 'butler.db')],
      galaxyDatabases: ['/Users/Shared/GOG.com/Galaxy/Storage/galaxy-2.0.db']
    }
  }

  const config = env.XDG_CONFIG_HOME ?? join(home, '.config')
  const flatpakHeroic = join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic')
  return {
    steamRoots: async () => [
      join(home, '.steam', 'steam'),
      join(home, '.local', 'share', 'Steam'),
      join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
    ],
    steamStatus: (appIds) =>
      readSteamStatusFromVdf(
        [
          join(home, '.steam', 'registry.vdf'),
          join(home, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'registry.vdf')
        ],
        appIds
      ),
    steamExecutable: async () => null,
    epicManifestDirs: [],
    legendaryInstalled: [
      join(config, 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
      join(flatpakHeroic, 'legendaryConfig', 'legendary', 'installed.json'),
      join(config, 'legendary', 'installed.json')
    ],
    legendaryBinaries: [
      {
        file: 'legendary',
        installedFile: join(config, 'legendary', 'installed.json'),
        defaultInstallDir: join(home, 'Games')
      },
      {
        file: '/opt/Heroic/resources/app.asar.unpacked/build/bin/x64/linux/legendary',
        configPath: join(config, 'heroic', 'legendaryConfig', 'legendary'),
        installedFile: join(config, 'heroic', 'legendaryConfig', 'legendary', 'installed.json'),
        heroicConfig: join(config, 'heroic', 'config.json'),
        defaultInstallDir: join(home, 'Games', 'Heroic')
      }
    ],
    gogRegistry: async () => [],
    gogGameDirs: [join(home, 'GOG Games')],
    heroicGogInstalled: [
      join(config, 'heroic', 'gog_store', 'installed.json'),
      join(flatpakHeroic, 'gog_store', 'installed.json')
    ],
    itchDatabases: [join(config, 'itch', 'db', 'butler.db')],
    galaxyDatabases: []
  }
}
