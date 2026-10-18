import { join } from 'node:path'
import { listDir, readJson } from './fs'
import type { DetectedGame, GameSource } from './types'

/** Subset of an Epic Games Launcher `.item` manifest. */
interface EpicManifest {
  DisplayName?: string
  AppName?: string
  MainGameAppName?: string
  InstallLocation?: string
  LaunchExecutable?: string
  bIsIncompleteInstall?: boolean
  AppCategories?: string[]
}

export function parseEpicManifest(manifest: EpicManifest): DetectedGame | null {
  const { DisplayName, AppName, InstallLocation } = manifest
  if (!DisplayName || !AppName || !InstallLocation) return null
  if (manifest.bIsIncompleteInstall) return null
  // DLCs point to their base game; non-game apps (Unreal Engine…) lack the "games" category.
  if (manifest.MainGameAppName && manifest.MainGameAppName !== AppName) return null
  if (manifest.AppCategories && !manifest.AppCategories.includes('games')) return null
  return {
    source: 'epic',
    sourceId: AppName,
    title: DisplayName,
    installPath: InstallLocation,
    executablePath: manifest.LaunchExecutable
      ? join(InstallLocation, manifest.LaunchExecutable)
      : null
  }
}

/** Legendary / Heroic `installed.json`: { [appName]: { title, install_path, executable, is_dlc } }. */
interface LegendaryInstalled {
  [appName: string]: {
    app_name?: string
    title?: string
    install_path?: string
    executable?: string
    is_dlc?: boolean
  }
}

export function parseLegendaryInstalled(data: LegendaryInstalled): DetectedGame[] {
  return Object.entries(data).flatMap(([key, game]) => {
    if (!game?.title || !game.install_path || game.is_dlc) return []
    return [
      {
        source: 'epic' as const,
        sourceId: game.app_name ?? key,
        title: game.title,
        installPath: game.install_path,
        executablePath: game.executable ? join(game.install_path, game.executable) : null
      }
    ]
  })
}

export interface EpicLocations {
  manifestDirs: string[]
  legendaryInstalled: string[]
}

export function epicSource(locations: () => EpicLocations): GameSource {
  const findManifests = async () => {
    for (const dir of locations().manifestDirs) {
      const items = (await listDir(dir)).filter((f) => f.toLowerCase().endsWith('.item'))
      if (items.length > 0) return { dir, items }
    }
    return null
  }
  const findLegendary = async () => {
    for (const file of locations().legendaryInstalled) {
      const data = await readJson<LegendaryInstalled>(file)
      if (data) return { file, data }
    }
    return null
  }

  return {
    id: 'epic',
    name: 'Epic Games',
    async locate() {
      return (await findManifests())?.dir ?? (await findLegendary())?.file ?? null
    },
    async scan() {
      const games = new Map<string, DetectedGame>()
      const manifests = await findManifests()
      if (manifests) {
        for (const item of manifests.items) {
          const data = await readJson<EpicManifest>(join(manifests.dir, item))
          const game = data && parseEpicManifest(data)
          if (game) games.set(game.sourceId, game)
        }
      }
      const legendary = await findLegendary()
      if (legendary) {
        for (const game of parseLegendaryInstalled(legendary.data)) {
          if (!games.has(game.sourceId)) games.set(game.sourceId, game)
        }
      }
      return [...games.values()]
    }
  }
}
