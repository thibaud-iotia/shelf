// Rockstar Games Launcher detection (Windows). The launcher writes a standard uninstall entry
// for every game it installs:
//   UninstallString  "C:\…\Grand Theft Auto V\uninstall.exe" -enableFullMode -uninstall=gta5
//   InstallLocation  C:\Program Files\Rockstar Games\Grand Theft Auto V
// The title id (`gta5`) is Shelf's sourceId. Pending updates come from the launcher's log.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROCKSTAR_TITLE_ID, rockstarTitle } from '../../shared/rockstar'
import type { RegistryKey } from '../platform/registry'
import { pendingUpdateFolders, readRockstarLogs, sameFolder } from './rockstar-log'
import type { DetectedGame, GameSource } from './types'

/** A game installed by the launcher, as its uninstall entry tells. */
export interface RockstarInstall {
  titleId: string
  title: string
  installPath: string
  version: string | null
}

const UNINSTALL = /(?:launcher|uninstall)\.exe"?\s.*-uninstall=([a-z0-9_]+)/i

/** Uninstall entries of the launcher's games (the launcher itself left out). */
export function rockstarInstalls(keys: RegistryKey[]): RockstarInstall[] {
  const found = new Map<string, RockstarInstall>()
  for (const key of keys) {
    const v = key.values
    const m = UNINSTALL.exec(v.uninstallstring ?? '')
    const titleId = m?.[1]?.toLowerCase()
    const installPath = v.installlocation?.replace(/^"|"$/g, '').trim()
    if (!titleId || titleId === 'launcher' || !ROCKSTAR_TITLE_ID.test(titleId) || !installPath) {
      continue
    }
    if (found.has(titleId)) continue
    found.set(titleId, {
      titleId,
      title: rockstarTitle(titleId)?.title ?? v.displayname ?? titleId,
      installPath,
      version: v.displayversion || null
    })
  }
  return [...found.values()]
}

/** `Launcher.exe` from the launcher's own key (`InstallFolder`), when it is on disk. */
export function launcherFromKey(keys: RegistryKey[]): string | null {
  const folder = keys.find((k) => /\\Rockstar Games\\Launcher$/i.test(k.path))?.values.installfolder
  if (!folder) return null
  const exe = join(folder, 'Launcher.exe')
  return existsSync(exe) ? exe : null
}

/** Saves folder of a catalogue game under `Documents\Rockstar Games`, when it exists. */
export function savesFolder(savesDir: string, titleId: string): string | null {
  const folder = rockstarTitle(titleId)?.saveFolder
  if (!savesDir || !folder) return null
  const path = join(savesDir, ...folder.split('\\'))
  return existsSync(path) ? path : null
}

export interface RockstarLocations {
  /** Uninstall entries (all programs: filtered here). */
  uninstallKeys: () => Promise<RegistryKey[]>
  /** `Launcher.exe`, null when the launcher is not installed. */
  launcher: () => Promise<string | null>
  /** Folder of `launcher.log`. */
  logDir: string
  /** `Documents\Rockstar Games`, where the games keep their saves. */
  savesDir: string
}

export function rockstarSource(locations: () => RockstarLocations): GameSource {
  const scan = async (): Promise<DetectedGame[]> => {
    const loc = locations()
    const installs = rockstarInstalls(await loc.uninstallKeys())
    if (!installs.length) return []
    // The table of the latest launcher start, minus the updates finished since.
    const pending = pendingUpdateFolders(await readRockstarLogs(loc.logDir, 1))
    return installs.map((install) => ({
      source: 'rockstar' as const,
      sourceId: install.titleId,
      title: install.title,
      installPath: install.installPath,
      // Started through Launcher.exe: no executable to run directly.
      executablePath: null,
      updateAvailable: pending.some((folder) => sameFolder(folder, install.installPath)),
      savePath: savesFolder(loc.savesDir, install.titleId)
    }))
  }
  return {
    id: 'rockstar',
    name: 'Rockstar Games',
    locate: async () => {
      const loc = locations()
      return (await loc.launcher()) ?? ((await scan()).length ? 'Registre Windows' : null)
    },
    scan
  }
}
