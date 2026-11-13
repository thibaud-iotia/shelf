import { dirname, join } from 'node:path'
import { exists, listDir, readJson } from './fs'
import type { DetectedGame, GameSource } from './types'

/** Subset of an Epic Games Launcher `.item` manifest. */
interface EpicManifest {
  DisplayName?: string
  AppName?: string
  MainGameAppName?: string
  InstallLocation?: string
  InstallationGuid?: string
  ManifestLocation?: string
  CompleteManifestPath?: string
  LaunchExecutable?: string
  bIsIncompleteInstall?: boolean
  AppCategories?: string[]
}

export function parseEpicManifest(
  manifest: EpicManifest,
  options: { allowIncomplete?: boolean } = {}
): DetectedGame | null {
  const { DisplayName, AppName, InstallLocation } = manifest
  if (!DisplayName || !AppName || !InstallLocation) return null
  if (manifest.bIsIncompleteInstall && !options.allowIncomplete) return null
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

/**
 * The Epic Games Launcher moves the `.item` of a game with a queued or running update to
 * `Manifests/Pending` (flagged incomplete) until the update is applied. The installed build
 * is still on disk: its complete manifest stays in `<install>/.egstore`. A first install in
 * progress has no complete manifest yet.
 */
async function hasCompleteInstall(manifest: EpicManifest): Promise<boolean> {
  const guid = manifest.InstallationGuid
  const candidates = [
    manifest.CompleteManifestPath,
    guid && manifest.ManifestLocation ? join(manifest.ManifestLocation, `${guid}.manifest`) : null,
    guid && manifest.InstallLocation
      ? join(manifest.InstallLocation, '.egstore', `${guid}.manifest`)
      : null
  ]
  for (const path of candidates) if (path && (await exists(path))) return true
  return false
}

/** Legendary / Heroic `installed.json`: { [appName]: { title, install_path, executable, is_dlc } }. */
interface LegendaryInstalled {
  [appName: string]: {
    app_name?: string
    title?: string
    install_path?: string
    executable?: string
    is_dlc?: boolean
    version?: string
    platform?: string
  }
}

/** Legendary `assets.json`: latest build per platform, refreshed by every `legendary list`. */
export interface LegendaryAssets {
  [platform: string]: { app_name?: string; build_version?: string }[] | undefined
}

export function parseLegendaryInstalled(
  data: LegendaryInstalled,
  assets: LegendaryAssets | null = null
): DetectedGame[] {
  return Object.entries(data).flatMap(([key, game]) => {
    if (!game?.title || !game.install_path || game.is_dlc) return []
    const appName = game.app_name ?? key
    const latest = assets?.[game.platform ?? 'Windows']?.find(
      (a) => a.app_name === appName
    )?.build_version
    const outdated = !!latest && !!game.version && latest !== game.version
    return [
      {
        source: 'epic' as const,
        sourceId: appName,
        title: game.title,
        installPath: game.install_path,
        executablePath: game.executable ? join(game.install_path, game.executable) : null,
        ...(outdated ? { updateAvailable: true } : {})
      }
    ]
  })
}

/** Whether the Epic Games Launcher has `appName` installed (a complete `.item` manifest). */
export async function epicLauncherHas(manifestDirs: string[], appName: string): Promise<boolean> {
  for (const dir of manifestDirs) {
    for (const item of (await listDir(dir)).filter((file) =>
      file.toLowerCase().endsWith('.item')
    )) {
      const data = await readJson<EpicManifest>(join(dir, item))
      if (data?.AppName === appName && !data.bIsIncompleteInstall) return true
    }
  }
  return false
}

export interface EpicLocations {
  manifestDirs: string[]
  legendaryInstalled: string[]
}

const isItem = (file: string) => file.toLowerCase().endsWith('.item')

export function epicSource(locations: () => EpicLocations): GameSource {
  const findManifests = async () => {
    for (const dir of locations().manifestDirs) {
      const items = (await listDir(dir)).filter(isItem)
      const pending = (await listDir(join(dir, 'Pending'))).filter(isItem)
      if (items.length > 0 || pending.length > 0) return { dir, items, pending }
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
        // Updates queued or running: the installed build stays playable once applied.
        for (const item of manifests.pending) {
          const data = await readJson<EpicManifest>(join(manifests.dir, 'Pending', item))
          const game = data && parseEpicManifest(data, { allowIncomplete: true })
          if (!game) continue
          const known = games.get(game.sourceId)
          if (known) games.set(game.sourceId, { ...known, updateAvailable: true })
          else if (await hasCompleteInstall(data)) {
            games.set(game.sourceId, { ...game, updateAvailable: true })
          }
        }
      }
      const legendary = await findLegendary()
      if (legendary) {
        const assets = await readJson<LegendaryAssets>(join(dirname(legendary.file), 'assets.json'))
        for (const game of parseLegendaryInstalled(legendary.data, assets)) {
          if (!games.has(game.sourceId)) games.set(game.sourceId, game)
        }
      }
      return [...games.values()]
    }
  }
}
