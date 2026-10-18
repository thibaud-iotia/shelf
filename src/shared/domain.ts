// Domain vocabulary shared by main, preload and renderer. No runtime dependencies.

export const GAME_SOURCES = ['steam', 'epic', 'gog', 'itch', 'manual'] as const
export type GameSourceId = (typeof GAME_SOURCES)[number]

export const OWNERSHIPS = ['owned', 'manual'] as const
export type Ownership = (typeof OWNERSHIPS)[number]

export const INSTALL_STATES = ['installed', 'not_installed', 'unknown'] as const
export type InstallState = (typeof INSTALL_STATES)[number]

export const SOURCE_LABELS: Record<GameSourceId, string> = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  itch: 'itch.io',
  manual: 'Manuel'
}

export const INSTALL_STATE_LABELS: Record<InstallState, string> = {
  installed: 'installé',
  not_installed: 'non installé',
  unknown: 'état inconnu'
}
