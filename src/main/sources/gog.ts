import { basename, join } from 'node:path'
import type { RegistryKey } from '../platform/registry'
import { isDirectory, listDir, readJson } from './fs'
import type { DetectedGame, GameSource } from './types'

/** GOG Galaxy registry entries: HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>. */
export function gamesFromRegistry(keys: RegistryKey[]): DetectedGame[] {
  return keys.flatMap((key) => {
    const v = key.values
    const id = v.gameid ?? basename(key.path)
    const title = v.gamename ?? v.startmenu
    const path = v.path
    if (!/^\d+$/.test(id) || !title || !path) return []
    // DLCs are registered with a dependsOn/rootGameId pointing to the base game.
    if (v.dependson && v.dependson !== id) return []
    return [
      {
        source: 'gog' as const,
        sourceId: id,
        title,
        installPath: path,
        executablePath: v.exe ?? null
      }
    ]
  })
}

/** `goggame-<id>.info` written by GOG installers in every game folder. */
interface GogInfo {
  gameId?: string
  rootGameId?: string
  name?: string
  playTasks?: { isPrimary?: boolean; type?: string; path?: string; category?: string }[]
}

export function parseGogInfo(info: GogInfo, folder: string): DetectedGame | null {
  if (!info.gameId || !info.name) return null
  if (info.rootGameId && info.rootGameId !== info.gameId) return null
  const task =
    info.playTasks?.find((t) => t.isPrimary && t.type === 'FileTask' && t.path) ??
    info.playTasks?.find((t) => t.type === 'FileTask' && t.path)
  return {
    source: 'gog',
    sourceId: info.gameId,
    title: info.name,
    installPath: folder,
    executablePath: task?.path ? join(folder, task.path) : null
  }
}

export async function readGogInfoFolder(folder: string): Promise<DetectedGame | null> {
  const file = (await listDir(folder)).find((f) => /^goggame-\d+\.info$/i.test(f))
  if (!file) return null
  const info = await readJson<GogInfo>(join(folder, file))
  return info ? parseGogInfo(info, folder) : null
}

/** Heroic `gog_store/installed.json`: { installed: [{ appName, install_path, is_dlc }] }. */
interface HeroicGogInstalled {
  installed?: { appName?: string; install_path?: string; is_dlc?: boolean; title?: string }[]
}

export async function gamesFromHeroic(data: HeroicGogInstalled): Promise<DetectedGame[]> {
  const games: DetectedGame[] = []
  for (const entry of data.installed ?? []) {
    if (!entry.appName || !entry.install_path || entry.is_dlc) continue
    const fromInfo = await readGogInfoFolder(entry.install_path)
    games.push(
      fromInfo ?? {
        source: 'gog',
        sourceId: entry.appName,
        title: entry.title ?? basename(entry.install_path),
        installPath: entry.install_path,
        executablePath: null
      }
    )
  }
  return games
}

export interface GogLocations {
  registry: () => Promise<RegistryKey[]>
  /** Folders whose sub-folders are GOG game installs (Galaxy's default library…). */
  gameDirs: string[]
  heroicInstalled: string[]
}

export function gogSource(locations: () => GogLocations): GameSource {
  const collect = async () => {
    const loc = locations()
    const games = new Map<string, DetectedGame>()
    let found: string | null = null

    const fromRegistry = gamesFromRegistry(await loc.registry())
    if (fromRegistry.length > 0) found = 'Registre Windows (GOG.com)'
    for (const game of fromRegistry) games.set(game.sourceId, game)

    for (const dir of loc.gameDirs) {
      if (!(await isDirectory(dir))) continue
      for (const child of await listDir(dir)) {
        const game = await readGogInfoFolder(join(dir, child))
        if (game && !games.has(game.sourceId)) {
          games.set(game.sourceId, game)
          found ??= dir
        }
      }
    }

    for (const file of loc.heroicInstalled) {
      const data = await readJson<HeroicGogInstalled>(file)
      if (!data) continue
      found ??= file
      for (const game of await gamesFromHeroic(data)) {
        if (!games.has(game.sourceId)) games.set(game.sourceId, game)
      }
    }
    return { found, games: [...games.values()] }
  }

  return {
    id: 'gog',
    name: 'GOG',
    locate: async () => (await collect()).found,
    scan: async () => (await collect()).games
  }
}
