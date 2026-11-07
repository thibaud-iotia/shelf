// Wording of a launch in progress (detail page, cards, list, sidebar). French UI.

import type { GameSourceId } from './domain'
import type { LaunchPhase, LaunchProgress } from './models'

/** Launcher names as the user knows the applications (not the store labels). */
const LAUNCHER_NAMES: Record<GameSourceId, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG Galaxy',
  itch: 'itch',
  manual: 'le jeu'
}

/** After this long in the same phase, the UI suggests checking the launcher's window. */
export const LAUNCH_STALL_MS = 30_000

export function launcherName(launcher: GameSourceId | null): string {
  return launcher ? LAUNCHER_NAMES[launcher] : 'le jeu'
}

/** "de Steam", "d’Epic Games". */
function ofLauncher(name: string): string {
  return /^[aeiouyéèêh]/i.test(name) ? `d’${name}` : `de ${name}`
}

/** Short status of a launch: "Démarrage de Steam…", "Steam lance le jeu…". */
export function launchPhaseLabel(phase: LaunchPhase, launcher: GameSourceId | null): string {
  const name = launcherName(launcher)
  switch (phase) {
    case 'starting':
      return 'Lancement…'
    case 'launcher':
      return `Démarrage ${ofLauncher(name)}…`
    case 'updating':
      return `${name} met à jour le jeu…`
    case 'waiting':
      return `${name} lance le jeu…`
    case 'handoff':
      return `Ouverture ${ofLauncher(name)}…`
  }
}

/** Compact status for narrow places (cover badges): "Steam démarre…", "Mise à jour…". */
export function launchPhaseShortLabel(phase: LaunchPhase, launcher: GameSourceId | null): string {
  switch (phase) {
    case 'launcher':
      return `${launcherName(launcher)} démarre…`
    case 'updating':
      return 'Mise à jour…'
    case 'handoff':
      return 'Ouverture…'
    default:
      return 'Lancement…'
  }
}

/**
 * A hint once a phase lasts (a launcher dialog may be waiting for the user: EULA,
 * cloud-save conflict, login…). Null while nothing looks stuck.
 */
export function launchStallHint(
  progress: Pick<LaunchProgress, 'phase' | 'launcher' | 'phaseSince'>,
  now: number
): string | null {
  if (progress.phase === 'updating' || progress.phase === 'handoff') return null
  if (now - progress.phaseSince < LAUNCH_STALL_MS) return null
  return progress.launcher && progress.launcher !== 'manual'
    ? `Rien ne se passe ? Vérifiez la fenêtre ${ofLauncher(launcherName(progress.launcher))}.`
    : 'Le jeu met du temps à démarrer…'
}

/** Elapsed time since the click: "4 s", "1 min 05". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`
}
