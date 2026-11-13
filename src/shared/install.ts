// Wording of a background install (detail page, cards, list). French UI.

import { formatBytes } from './format'
import type { InstallLocation, InstallProgress, InstallSource } from './models'

/** After this long queued in Steam, the UI suggests looking at Steam's downloads. */
export const INSTALL_QUEUED_STALL_MS = 90_000

/** Launchers Shelf installs to in the background (the install location can be chosen). */
export function isInstallSource(source: unknown): source is InstallSource {
  return source === 'steam' || source === 'epic'
}

/** "812 Go libres", or null when unknown. */
export function freeSpaceLabel(location: Pick<InstallLocation, 'freeBytes'>): string | null {
  return location.freeBytes === null ? null : `${formatBytes(location.freeBytes)} libres`
}

/** "42 %", or null while the launcher tells no progress. */
export function installPercent(progress: Pick<InstallProgress, 'progress'>): string | null {
  return progress.progress === null ? null : `${Math.floor(progress.progress * 100)} %`
}

/** Status of an install: "Redémarrage de Steam…", "Téléchargement 42 %". */
export function installPhaseLabel(
  progress: Pick<InstallProgress, 'phase' | 'source' | 'progress'>
): string {
  const steam = progress.source === 'steam'
  switch (progress.phase) {
    case 'preparing':
      return steam ? 'Ajout à Steam…' : 'Préparation…'
    case 'restarting':
      return 'Redémarrage de Steam…'
    case 'waitingGame':
      return 'En attente de Steam…'
    case 'queued':
      return 'En file dans Steam…'
    case 'allocating':
      return 'Allocation de l’espace disque…'
    case 'downloading': {
      const percent = installPercent(progress)
      return percent ? `Téléchargement ${percent}` : 'Téléchargement…'
    }
    case 'finishing':
      return 'Finalisation…'
    case 'paused':
      return 'En pause dans Steam'
  }
}

/** Compact status for cover badges: "42 %", "Installation…". */
export function installShortLabel(progress: Pick<InstallProgress, 'phase' | 'progress'>): string {
  if (progress.phase === 'paused') return 'En pause'
  if (progress.phase === 'finishing') return 'Finalisation…'
  return installPercent(progress) ?? 'Installation…'
}

/** "1,2 Go / 3,4 Go" when the launcher tells the sizes. */
export function installBytesLabel(
  progress: Pick<InstallProgress, 'downloadedBytes' | 'totalBytes'>
): string | null {
  if (!progress.totalBytes) return null
  return `${formatBytes(progress.downloadedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
}

/** A line under the button when the install waits on something the user may act on. */
export function installHint(
  progress: Pick<InstallProgress, 'phase' | 'source' | 'startedAt'>,
  now: number
): string | null {
  if (progress.phase === 'waitingGame') {
    return 'Un jeu Steam est en cours : Steam redémarrera quand il sera fermé.'
  }
  if (progress.phase === 'paused') return 'Reprenez le téléchargement depuis Steam.'
  if (
    progress.source === 'steam' &&
    progress.phase === 'queued' &&
    now - progress.startedAt > INSTALL_QUEUED_STALL_MS
  ) {
    return 'Le téléchargement ne démarre pas ? Vérifiez la file de Steam.'
  }
  return null
}
