import type { LauncherLocations } from '../platform/paths'
import { epicSource } from './epic'
import { gogSource } from './gog'
import { itchSource } from './itch'
import { steamSource } from './steam'
import type { GameSource } from './types'

/** Every launcher Shelf can detect, wired to the OS locations of `paths.ts`. */
export function createSources(locations: () => LauncherLocations): GameSource[] {
  return [
    steamSource(() => locations().steamRoots()),
    epicSource(() => ({
      manifestDirs: locations().epicManifestDirs,
      legendaryInstalled: locations().legendaryInstalled
    })),
    gogSource(() => ({
      registry: locations().gogRegistry,
      gameDirs: locations().gogGameDirs,
      heroicInstalled: locations().heroicGogInstalled
    })),
    itchSource(() => locations().itchDatabases)
  ]
}
