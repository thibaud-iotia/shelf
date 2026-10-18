import Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import { firstExisting } from '../sources/fs'
import type { AccountProvider, OwnedGame } from './types'

// GOG option A: the local GOG Galaxy 2.0 database already lists every owned game.
// Read-only, no network, no credentials.

export function readGalaxyOwned(file: string): OwnedGame[] {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = db
      .prepare(
        `SELECT lr.releaseKey AS releaseKey, gpt.type AS type, gp.value AS value
         FROM LibraryReleases lr
         JOIN GamePieces gp ON gp.releaseKey = lr.releaseKey
         JOIN GamePieceTypes gpt ON gpt.id = gp.gamePieceTypeId
         WHERE lr.releaseKey LIKE 'gog\\_%' ESCAPE '\\'
           AND gpt.type IN ('title', 'originalTitle')`
      )
      .all() as { releaseKey: string; type: string; value: string }[]

    const titles = new Map<string, { title?: string; original?: string }>()
    for (const row of rows) {
      let title: string | undefined
      try {
        title = (JSON.parse(row.value) as { title?: string }).title
      } catch {
        continue
      }
      if (!title) continue
      const entry = titles.get(row.releaseKey) ?? {}
      if (row.type === 'originalTitle') entry.original = title
      else entry.title = title
      titles.set(row.releaseKey, entry)
    }
    return [...titles.entries()].map(([key, t]) => ({
      source: 'gog' as const,
      sourceId: key.slice('gog_'.length),
      title: t.title ?? t.original!
    }))
  } finally {
    db.close()
  }
}

export function gogGalaxyProvider(databases: () => string[]): AccountProvider<unknown> {
  const locate = async () => {
    const file = await firstExisting(databases())
    if (!file) {
      throw new AppError(
        'UNAVAILABLE',
        'Base GOG Galaxy introuvable : installez GOG Galaxy 2.0 et connectez-vous une fois.'
      )
    }
    return file
  }
  return {
    kind: 'gog-galaxy',
    source: 'gog',
    async connect() {
      const file = await locate()
      readGalaxyOwned(file) // validates the schema
      return { displayName: 'GOG Galaxy (local)', externalUserId: 'galaxy-local', secret: null }
    },
    async fetchOwned() {
      return { games: readGalaxyOwned(await locate()) }
    }
  }
}
