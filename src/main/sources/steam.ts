import { join } from 'node:path'
import { exists, firstExisting, listDir, readText } from './fs'
import type { DetectedGame, GameSource } from './types'
import { parseVdf, vdfObject, vdfString } from './vdf'

// Steam tools that show up as "apps" but are not games.
const TOOL_APP_IDS = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '2180100'])
const TOOL_NAME = /^(proton\b|steam linux runtime|steamworks common|steamvr)/i

/** Library folders listed in libraryfolders.vdf (new and legacy formats). */
export function parseLibraryFolders(text: string): string[] {
  const root = parseVdf(text)
  const folders = vdfObject(root.libraryfolders)
  if (!folders) return []
  const paths: string[] = []
  for (const [key, value] of Object.entries(folders)) {
    if (!/^\d+$/.test(key)) continue
    const path = typeof value === 'string' ? value : vdfString(value.path)
    if (path) paths.push(path)
  }
  return paths
}

export interface AppManifest {
  appId: string
  name: string
  installDir: string
  installed: boolean
}

export function parseAppManifest(text: string): AppManifest | null {
  const state = vdfObject(parseVdf(text).appstate)
  const appId = vdfString(state?.appid)
  const name = vdfString(state?.name)
  const installDir = vdfString(state?.installdir)
  if (!state || !appId || !name || !installDir) return null
  // StateFlags bit 4 = fully installed.
  const flags = Number.parseInt(vdfString(state.stateflags) ?? '0', 10)
  return { appId, name, installDir, installed: (flags & 4) === 4 }
}

export function isSteamTool(manifest: AppManifest): boolean {
  return TOOL_APP_IDS.has(manifest.appId) || TOOL_NAME.test(manifest.name)
}

async function libraryPaths(root: string): Promise<string[]> {
  const vdf = await readText(
    (await firstExisting([
      join(root, 'steamapps', 'libraryfolders.vdf'),
      join(root, 'config', 'libraryfolders.vdf')
    ])) ?? ''
  )
  const listed = vdf ? safe(() => parseLibraryFolders(vdf), []) : []
  const unique = new Map<string, string>()
  for (const path of [root, ...listed]) unique.set(path.toLowerCase().replace(/[\\/]+$/, ''), path)
  return [...unique.values()]
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export async function scanSteamRoot(root: string): Promise<DetectedGame[]> {
  const games = new Map<string, DetectedGame>()
  for (const library of await libraryPaths(root)) {
    const steamapps = join(library, 'steamapps')
    for (const file of await listDir(steamapps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue
      const text = await readText(join(steamapps, file))
      const manifest = text ? safe(() => parseAppManifest(text), null) : null
      if (!manifest || !manifest.installed || isSteamTool(manifest)) continue
      games.set(manifest.appId, {
        source: 'steam',
        sourceId: manifest.appId,
        title: manifest.name,
        installPath: join(steamapps, 'common', manifest.installDir),
        executablePath: null
      })
    }
  }
  return [...games.values()]
}

export function steamSource(roots: () => Promise<string[]>): GameSource {
  const locate = async () => {
    for (const root of await roots()) {
      if (await exists(join(root, 'steamapps'))) return root
    }
    return null
  }
  return {
    id: 'steam',
    name: 'Steam',
    locate,
    async scan() {
      const root = await locate()
      return root ? scanSteamRoot(root) : []
    }
  }
}
