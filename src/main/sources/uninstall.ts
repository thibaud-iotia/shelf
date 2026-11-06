// How an installed game is uninstalled from Shelf:
// - Steam: its uninstall URI (Steam asks for confirmation);
// - GOG and manual games on Windows: the uninstaller the installer left in the game folder
//   (Inno Setup `unins000.exe` for GOG). Linux scripts expect a terminal: not run from Shelf.
// Epic (no uninstaller in the folder) and itch.io are uninstalled from their launcher.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { GameSourceId } from '../../shared/domain'
import { uninstallUri } from './uris'

interface UninstallTarget {
  source: GameSourceId
  sourceId: string
  installPath: string | null
}

export type UninstallPlan = { kind: 'uri'; uri: string } | { kind: 'program'; path: string }

const PROGRAM_SOURCES: readonly GameSourceId[] = ['gog', 'manual']

function uninstallerPattern(platform: NodeJS.Platform): RegExp | null {
  if (platform === 'win32') return /^(unins\d*|uninstall(er)?)\.exe$/i
  return null
}

/** Cheap check, without touching the disk: whether Shelf can try to uninstall the game. */
export function mayUninstall(
  game: UninstallTarget,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (uninstallUri(game) !== null) return true
  return (
    game.installPath !== null &&
    PROGRAM_SOURCES.includes(game.source) &&
    uninstallerPattern(platform) !== null
  )
}

/** The uninstaller at the top of the game folder; `unins000.exe` before `unins001.exe`. */
export function findUninstaller(
  installPath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const pattern = uninstallerPattern(platform)
  if (!pattern) return null
  let names: string[]
  try {
    names = readdirSync(installPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return null
  }
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
  return names.length > 0 ? join(installPath, names[0]!) : null
}

export function uninstallPlan(
  game: UninstallTarget,
  platform: NodeJS.Platform = process.platform
): UninstallPlan | null {
  const uri = uninstallUri(game)
  if (uri) return { kind: 'uri', uri }
  if (!mayUninstall(game, platform) || !game.installPath) return null
  const path = findUninstaller(game.installPath, platform)
  return path ? { kind: 'program', path } : null
}
