import type { GameSourceId } from '../../shared/domain'

/** A game installed locally, as reported by a launcher's own files. */
export interface DetectedGame {
  source: GameSourceId
  sourceId: string
  title: string
  installPath: string | null
  executablePath: string | null
}

/**
 * Detection side of a launcher (PLAN: GameSource). Launching is decided by
 * `launch/plan.ts` from the stored row, so it is not part of this interface.
 */
export interface GameSource {
  id: GameSourceId
  name: string
  /** Where the launcher's data was found, or null when absent. */
  locate(): Promise<string | null>
  scan(): Promise<DetectedGame[]>
}
