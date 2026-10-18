// Launcher URI schemes. Used to launch launcher-managed games and to open the
// launcher's install / uninstall page for games that are owned but not installed.

import type { GameSourceId } from '../../shared/domain'

interface UriTarget {
  source: GameSourceId
  sourceId: string
}

export function launchUri(
  game: UriTarget,
  platform: NodeJS.Platform = process.platform
): string | null {
  const id = encodeURIComponent(game.sourceId)
  switch (game.source) {
    case 'steam':
      return `steam://rungameid/${id}`
    case 'epic':
      return platform === 'linux'
        ? `heroic://launch?appName=${id}&runner=legendary`
        : `com.epicgames.launcher://apps/${id}?action=launch&silent=true`
    case 'gog':
      return platform === 'linux'
        ? `heroic://launch?appName=${id}&runner=gog`
        : `goggalaxy://openGameView/${id}`
    default:
      return null
  }
}

export function installUri(
  game: UriTarget,
  platform: NodeJS.Platform = process.platform
): string | null {
  const id = encodeURIComponent(game.sourceId)
  switch (game.source) {
    case 'steam':
      return `steam://install/${id}`
    case 'epic':
      return platform === 'linux'
        ? 'heroic://'
        : `com.epicgames.launcher://apps/${id}?action=install`
    case 'gog':
      return platform === 'linux' ? 'heroic://' : `goggalaxy://openGameView/${id}`
    case 'itch':
      return `itch://games/${id}`
    default:
      return null
  }
}

/** Only Steam exposes a reliable uninstall URI; other launchers are uninstalled from their own UI. */
export function uninstallUri(game: UriTarget): string | null {
  return game.source === 'steam' ? `steam://uninstall/${encodeURIComponent(game.sourceId)}` : null
}
