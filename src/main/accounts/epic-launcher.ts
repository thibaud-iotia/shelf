import { readFile } from 'node:fs/promises'
import { AppError } from '../../shared/errors'
import { firstExisting } from '../sources/fs'
import type { AccountProvider, OwnedGame } from './types'

// Epic without Legendary: the Epic Games Launcher keeps the catalog entries of everything
// the logged-in account owns in `Data/Catalog/catcache.bin` (base64 of a JSON array), and
// refreshes it each time it opens its library. Read-only, no network, no credentials.

/** Subset of a catalog item of `catcache.bin`. */
interface EpicCatalogItem {
  id?: string
  title?: string
  categories?: { path?: string }[]
  releaseInfo?: { appId?: string; platform?: string[] }[]
  /** Add-ons point to their base game; base games carry `{ id: '' }`. */
  mainGameItem?: { id?: string } | null
}

/** Decodes `catcache.bin`: base64 JSON (older launchers wrote the JSON as is). */
export function decodeCatalogCache(content: string): EpicCatalogItem[] {
  const text = content.trim()
  let data: unknown
  try {
    data = JSON.parse(text.startsWith('[') ? text : Buffer.from(text, 'base64').toString('utf8'))
  } catch {
    throw new AppError('UNAVAILABLE', 'Cache de l’Epic Games Launcher illisible.')
  }
  if (!Array.isArray(data)) {
    throw new AppError('UNAVAILABLE', 'Cache de l’Epic Games Launcher inattendu.')
  }
  return data as EpicCatalogItem[]
}

const hasCategory = (item: EpicCatalogItem, path: string) =>
  !!item.categories?.some((c) => c.path === path)

/**
 * App name of an item (`AppName` of the launcher's `.item` manifests, Shelf's sourceId):
 * the release of `platform` first, any release otherwise.
 */
function appNameOf(item: EpicCatalogItem, platform: string): string | null {
  const releases = (item.releaseInfo ?? []).filter((r) => r.appId)
  const release = releases.find((r) => r.platform?.includes(platform)) ?? releases[0]
  return release?.appId ?? null
}

/**
 * Owned games of the cache. Only "games" are kept (engines, Fab assets and tools also live
 * there); add-ons are attached to their base game, or unlisted when it is not owned.
 * Hidden entries (content packs of Fortnite…) are left out.
 */
export function parseEpicCatalog(items: EpicCatalogItem[], platform = 'Windows'): OwnedGame[] {
  const appNames = new Map<string, string>()
  for (const item of items) {
    const appName = appNameOf(item, platform)
    if (item.id && appName && hasCategory(item, 'games') && !item.mainGameItem?.id) {
      appNames.set(item.id, appName)
    }
  }
  const owned = new Map<string, OwnedGame>()
  for (const item of items) {
    const appName = appNameOf(item, platform)
    const title = item.title?.trim()
    if (!appName || !title || owned.has(appName) || hasCategory(item, 'hidden')) continue
    const base = { source: 'epic' as const, sourceId: appName, title }
    const parentId = item.mainGameItem?.id
    if (parentId) {
      if (!hasCategory(item, 'games') && !hasCategory(item, 'addons')) continue
      const parent = appNames.get(parentId)
      owned.set(appName, parent ? { ...base, dlcOf: parent } : { ...base, unlisted: true })
    } else if (hasCategory(item, 'games')) {
      owned.set(appName, base)
    }
  }
  return [...owned.values()]
}

export function epicLauncherProvider(
  caches: () => string[],
  platform: string = process.platform === 'darwin' ? 'Mac' : 'Windows'
): AccountProvider<unknown> {
  const read = async () => {
    const file = await firstExisting(caches())
    if (!file) {
      throw new AppError(
        'UNAVAILABLE',
        'Bibliothèque Epic introuvable : ouvrez l’Epic Games Launcher une fois, connecté à votre compte.'
      )
    }
    return parseEpicCatalog(decodeCatalogCache(await readFile(file, 'utf8')), platform)
  }
  return {
    kind: 'epic-launcher',
    source: 'epic',
    local: true,
    async connect() {
      await read() // validates the cache
      return {
        displayName: 'Epic Games Launcher (local)',
        externalUserId: 'epic-launcher-local',
        secret: null
      }
    },
    async fetchOwned() {
      return { games: await read() }
    }
  }
}
