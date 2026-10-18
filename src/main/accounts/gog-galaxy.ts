import Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import { firstExisting } from '../sources/fs'
import type { AccountProvider, OwnedGame } from './types'

// GOG option A: the local GOG Galaxy 2.0 database already lists every owned game.
// Read-only, no network, no credentials.

const GOG_KEY = `LIKE 'gog\\_%' ESCAPE '\\'`

function parsePiece<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
}

/** Internal names Galaxy shows for add-ons of other editions (`dlc_15_a`). */
const PLACEHOLDER_TITLE = /^dlc_\d+_[a-z]$/i
/** Same add-on, other edition: "Temerian Armor Set [A]". */
const EDITION_SUFFIX = /\s*\[[A-Z]\]$/

export function readGalaxyOwned(file: string): OwnedGame[] {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const rows = db
      .prepare(
        `SELECT lr.releaseKey AS releaseKey, gpt.type AS type, gp.value AS value
         FROM LibraryReleases lr
         JOIN GamePieces gp ON gp.releaseKey = lr.releaseKey
         JOIN GamePieceTypes gpt ON gpt.id = gp.gamePieceTypeId
         WHERE lr.releaseKey ${GOG_KEY}
           AND gpt.type IN ('title', 'originalTitle', 'allGameReleases')`
      )
      .all() as { releaseKey: string; type: string; value: string }[]

    const titles = new Map<string, { title?: string; original?: string }>()
    const editions = new Map<string, string[]>()
    for (const row of rows) {
      if (row.type === 'allGameReleases') {
        const releases = parsePiece<{ releases?: string[] }>(row.value)?.releases
        if (releases) editions.set(row.releaseKey, releases)
        continue
      }
      const title = parsePiece<{ title?: string }>(row.value)?.title
      if (!title) continue
      const entry = titles.get(row.releaseKey) ?? {}
      if (row.type === 'originalTitle') entry.original = title
      else entry.title = title
      titles.set(row.releaseKey, entry)
    }

    // Add-ons: `ReleaseProperties.isDlc` (hidden duplicates: `isVisibleInLibrary = 0`), and
    // the `dlcs` piece of each base game — kept for releases outside the library too, since
    // an add-on may point to another edition of a game the user owns.
    const props = new Map<string, { isDlc: boolean; visible: boolean }>()
    if (hasTable(db, 'ReleaseProperties')) {
      const all = db
        .prepare(
          `SELECT releaseKey, isDlc, isVisibleInLibrary FROM ReleaseProperties
           WHERE releaseKey ${GOG_KEY}`
        )
        .all() as { releaseKey: string; isDlc: number | null; isVisibleInLibrary: number | null }[]
      for (const p of all) {
        props.set(p.releaseKey, { isDlc: p.isDlc === 1, visible: p.isVisibleInLibrary !== 0 })
      }
    }
    const parentOf = new Map<string, string>()
    const dlcPieces = db
      .prepare(
        `SELECT gp.releaseKey AS releaseKey, gp.value AS value FROM GamePieces gp
         JOIN GamePieceTypes gpt ON gpt.id = gp.gamePieceTypeId
         WHERE gpt.type = 'dlcs' AND gp.releaseKey ${GOG_KEY}`
      )
      .all() as { releaseKey: string; value: string }[]
    for (const piece of dlcPieces) {
      for (const dlc of parsePiece<{ dlcs?: string[] }>(piece.value)?.dlcs ?? []) {
        if (dlc !== piece.releaseKey && !parentOf.has(dlc)) parentOf.set(dlc, piece.releaseKey)
      }
    }
    const isDlc = (key: string) => props.get(key)?.isDlc ?? parentOf.has(key)

    // Base game owned by the user for a parent key: itself, or the edition listing it.
    const owner = new Map<string, string>()
    for (const key of titles.keys()) {
      if (isDlc(key) || props.get(key)?.visible === false) continue
      owner.set(key, key)
    }
    for (const key of [...owner.keys()]) {
      for (const release of editions.get(key) ?? [])
        if (!owner.has(release)) owner.set(release, key)
    }

    // Time played through Galaxy (absent from older databases).
    const minutes = new Map<string, number>()
    const hasTimes = hasTable(db, 'GameTimes')
    if (hasTimes) {
      const times = db
        .prepare(
          `SELECT releaseKey, sum(minutesInGame) AS minutes FROM GameTimes
           WHERE releaseKey ${GOG_KEY} GROUP BY releaseKey`
        )
        .all() as { releaseKey: string; minutes: number | null }[]
      for (const t of times) minutes.set(t.releaseKey, t.minutes ?? 0)
    }

    const addOnTitles = new Set<string>()
    const owned: OwnedGame[] = []
    // Untagged add-ons first, so the "[A]" copy is the one dropped.
    const ordered = [...titles].sort(
      ([, a], [, b]) =>
        Number(EDITION_SUFFIX.test(a.title ?? a.original!)) -
        Number(EDITION_SUFFIX.test(b.title ?? b.original!))
    )
    for (const [key, t] of ordered) {
      const title = t.title ?? t.original!
      const base = { source: 'gog' as const, sourceId: key.slice('gog_'.length), title }
      if (props.get(key)?.visible === false) {
        owned.push({ ...base, unlisted: true })
      } else if (isDlc(key)) {
        const parent = owner.get(parentOf.get(key) ?? '')
        const name = title.replace(EDITION_SUFFIX, '')
        const id = `${parent}/${name}`
        if (!parent || addOnTitles.has(id) || PLACEHOLDER_TITLE.test(title)) {
          owned.push({ ...base, unlisted: true })
        } else {
          addOnTitles.add(id)
          owned.push({ ...base, title: name, dlcOf: parent.slice('gog_'.length) })
        }
      } else {
        owned.push({ ...base, ...(hasTimes ? { playtimeMin: minutes.get(key) ?? 0 } : {}) })
      }
    }
    return owned
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
    local: true,
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
