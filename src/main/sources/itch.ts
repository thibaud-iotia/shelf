import { join } from 'node:path'
import Database from 'better-sqlite3'
import { firstExisting } from './fs'
import type { DetectedGame, GameSource } from './types'

interface CaveRow {
  game_id: number
  title: string
  verdict: string | null
  install_folder_name: string | null
  location_path: string | null
}

interface Verdict {
  basePath?: string
  candidates?: { path?: string; flavor?: string }[]
}

/** Reads installed games ("caves") from the itch app's butler database, read-only. */
export function readButlerCaves(file: string): DetectedGame[] {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = db
      .prepare(
        `SELECT c.game_id, g.title, c.verdict, c.install_folder_name, l.path AS location_path
         FROM caves c
         JOIN games g ON g.id = c.game_id
         LEFT JOIN install_locations l ON l.id = c.install_location_id`
      )
      .all() as CaveRow[]

    return rows.map((row) => {
      let verdict: Verdict = {}
      try {
        verdict = row.verdict ? (JSON.parse(row.verdict) as Verdict) : {}
      } catch {
        // Corrupt verdict: keep the install folder only.
      }
      const installPath =
        verdict.basePath ??
        (row.location_path && row.install_folder_name
          ? join(row.location_path, row.install_folder_name)
          : null)
      const candidate = verdict.candidates?.find((c) => c.path)
      return {
        source: 'itch' as const,
        sourceId: String(row.game_id),
        title: row.title,
        installPath,
        executablePath: installPath && candidate?.path ? join(installPath, candidate.path) : null
      }
    })
  } finally {
    db.close()
  }
}

export function itchSource(databases: () => string[]): GameSource {
  const locate = () => firstExisting(databases())
  return {
    id: 'itch',
    name: 'itch.io',
    locate,
    async scan() {
      const file = await locate()
      return file ? readButlerCaves(file) : []
    }
  }
}
