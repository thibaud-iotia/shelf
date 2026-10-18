import { SOURCE_LABELS } from '../../shared/domain'
import type { ImportCandidate } from '../../shared/models'
import type { GameRow } from '../games/repository'
import { normalizeTitle } from '../games/titles'
import type { FolderFinding } from '../sources/folder-scan'
import { isInside } from '../sources/folder-scan'
import type { DetectedGame } from '../sources/types'

const samePath = (a: string | null, b: string | null) =>
  !!a && !!b && (process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase())

export const launcherKey = (game: { source: string; sourceId: string }) =>
  `${game.source}:${game.sourceId}`
export const fileKey = (path: string) =>
  `file:${process.platform === 'linux' ? path : path.toLowerCase()}`

/**
 * Turns raw detections into the import list of mockup 04:
 * - launcher games already in the library → `update` (refreshed automatically);
 * - new launcher games → `new`, trusted (no review);
 * - folder finds → `new` to review, `duplicate` when the title matches an existing game,
 *   dropped when the executable is already known or lies inside a launcher install;
 * - excluded executables → `excluded`, restorable.
 */
export function buildCandidates(
  detected: DetectedGame[],
  findings: FolderFinding[],
  existing: GameRow[]
): ImportCandidate[] {
  const bySourceId = new Map(existing.map((g) => [launcherKey(g), g]))
  const byTitle = new Map<string, GameRow>()
  for (const game of existing) {
    const key = normalizeTitle(game.title)
    if (key && !byTitle.has(key)) byTitle.set(key, game)
  }
  const candidates: ImportCandidate[] = []

  for (const game of detected) {
    const known = bySourceId.get(launcherKey(game))
    candidates.push({
      key: launcherKey(game),
      source: game.source,
      sourceId: game.sourceId,
      title: known?.title ?? game.title,
      executablePath: game.executablePath,
      installPath: game.installPath,
      status: known ? 'update' : 'new',
      needsReview: false,
      duplicateOf: null,
      excludedReason: null
    })
  }

  const launcherInstalls = detected.map((g) => g.installPath).filter((p): p is string => !!p)
  const seen = new Set<string>()

  for (const finding of findings) {
    const key = fileKey(finding.path)
    if (seen.has(key)) continue
    seen.add(key)
    if (existing.some((g) => samePath(g.executablePath, finding.path))) continue
    if (launcherInstalls.some((dir) => isInside(finding.path, dir))) continue

    const base = {
      key,
      source: 'manual' as const,
      sourceId: '',
      title: finding.title,
      executablePath: finding.path,
      installPath: finding.folder,
      needsReview: true,
      duplicateOf: null,
      excludedReason: null
    }
    const fromLauncher = detected.find(
      (g) => normalizeTitle(g.title) === normalizeTitle(finding.title)
    )
    const excludedReason =
      finding.excludedReason ??
      (fromLauncher ? `déjà détecté via ${SOURCE_LABELS[fromLauncher.source]}` : null)
    if (excludedReason) {
      candidates.push({ ...base, status: 'excluded', excludedReason })
      continue
    }
    const twin =
      byTitle.get(normalizeTitle(finding.title)) ??
      existing.find((g) => samePath(g.installPath, finding.folder))
    candidates.push(
      twin
        ? {
            ...base,
            status: 'duplicate',
            duplicateOf: { id: twin.id, title: twin.title, source: twin.source }
          }
        : { ...base, status: 'new' }
    )
  }
  return candidates
}
