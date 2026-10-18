import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import {
  addToCollection,
  createCollection,
  deleteCollection,
  listCollections,
  listTags,
  removeFromCollection,
  setGameTags,
  updateCollection,
  validateRules
} from '../../src/main/games/organize'
import { deleteGame, getGame } from '../../src/main/games/repository'
import {
  collectionGames,
  filterGames,
  fuzzyScore,
  isEmptyRules,
  matchesRules,
  searchGames
} from '../../src/shared/library'
import type { Game } from '../../src/shared/models'
import { MIGRATIONS } from './helpers'

function game(partial: Partial<Game> & { id: number; title: string }): Game {
  return {
    source: 'manual',
    sourceId: String(partial.id),
    ownership: 'manual',
    installState: 'installed',
    installPath: null,
    executablePath: null,
    launchArgs: null,
    coverUrl: null,
    heroUrl: null,
    logoUrl: null,
    screenshotUrls: [],
    description: null,
    releaseDate: null,
    developer: null,
    genres: [],
    igdbId: null,
    favorite: false,
    hidden: false,
    addedAt: 0,
    lastSyncedAt: null,
    playtimeSec: 0,
    externalPlaytimeMin: null,
    lastPlayedAt: null,
    lastSessionSec: null,
    sessionCount: 0,
    tags: [],
    collectionIds: [],
    savePath: null,
    useRunner: false,
    canInstall: false,
    canUninstall: false,
    ...partial
  }
}

const library: Game[] = [
  game({
    id: 1,
    title: 'Hades',
    source: 'steam',
    favorite: true,
    genres: ['Roguelike'],
    tags: ['co-op'],
    playtimeSec: 50 * 3600,
    sessionCount: 3,
    lastPlayedAt: 5
  }),
  game({
    id: 2,
    title: 'Hollow Knight',
    source: 'gog',
    installState: 'not_installed',
    developer: 'Team Cherry'
  }),
  game({ id: 3, title: 'Pokémon Émeraude', tags: ['rejoué'] }),
  game({ id: 4, title: 'Secret Game', hidden: true }),
  game({
    id: 5,
    title: 'Hades II',
    source: 'epic',
    genres: ['roguelike'],
    lastPlayedAt: 9,
    sessionCount: 1
  })
]

describe('filterGames', () => {
  const titles = (list: Game[]) => list.map((g) => g.title)

  it('hides hidden games unless asked', () => {
    expect(titles(filterGames(library, {}))).not.toContain('Secret Game')
    expect(titles(filterGames(library, { showHidden: true }))).toContain('Secret Game')
  })

  it('combines install state, favorites, tag and text (accent-insensitive)', () => {
    expect(titles(filterGames(library, { install: 'not_installed' }))).toEqual(['Hollow Knight'])
    expect(titles(filterGames(library, { install: 'installed', favoritesOnly: true }))).toEqual([
      'Hades'
    ])
    expect(titles(filterGames(library, { tag: 'rejoué' }))).toEqual(['Pokémon Émeraude'])
    expect(titles(filterGames(library, { text: 'pokemon emer' }))).toEqual(['Pokémon Émeraude'])
    expect(titles(filterGames(library, { text: 'cherry' }))).toEqual(['Hollow Knight'])
  })
})

describe('smart collections', () => {
  it('matches every criterion', () => {
    expect(
      matchesRules(library[0]!, { sources: ['steam'], favorite: true, minPlaytimeHours: 40 })
    ).toBe(true)
    expect(matchesRules(library[0]!, { neverPlayed: true })).toBe(false)
    expect(matchesRules(library[4]!, { genres: ['Roguelike'] })).toBe(true)
    expect(matchesRules(library[1]!, { installed: false })).toBe(true)
    expect(isEmptyRules({ tags: [], favorite: false })).toBe(true)
  })

  it('lists members in order (manual) or by rules (smart)', () => {
    expect(
      collectionGames({ id: 1, name: 'M', rules: null, gameIds: [5, 4, 1] }, library).map(
        (g) => g.id
      )
    ).toEqual([5, 1])
    expect(
      collectionGames(
        { id: 2, name: 'S', rules: { genres: ['roguelike'] }, gameIds: [] },
        library
      ).map((g) => g.id)
    ).toEqual([1, 5])
  })
})

describe('fuzzy search', () => {
  it('ranks exact > prefix > word start > substring > subsequence', () => {
    const scores = ['hades', 'hades ii', 'the hades', 'shades', 'h a d e s'].map((t) =>
      fuzzyScore('hades', t)!
    )
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(fuzzyScore('xyz', 'hades')).toBeNull()
    expect(fuzzyScore('hk', 'Hollow Knight')).not.toBeNull()
  })

  it('searches visible games, recent first on ties', () => {
    expect(searchGames(library, 'hades').map((g) => g.title)).toEqual(['Hades', 'Hades II'])
    expect(searchGames(library, 'secret')).toEqual([])
  })
})

describe('tags and collections in the database', () => {
  let handle: DatabaseHandle
  let ids: number[]
  beforeEach(() => {
    handle = openDatabase(':memory:', MIGRATIONS)
    ids = ['Hades', 'Celeste', 'Doom'].map(
      (title) =>
        handle.db
          .insert(games)
          .values({ title, source: 'manual', sourceId: title })
          .returning()
          .get().id
    )
  })
  afterEach(() => handle.close())

  it('sets tags (normalized), counts them, drops orphans', () => {
    setGameTags(handle.db, ids[0]!, ['Co-op', ' cosy ', 'co-op'])
    setGameTags(handle.db, ids[1]!, ['cosy'])
    expect(getGame(handle.db, ids[0]!).tags).toEqual(['co-op', 'cosy'])
    expect(listTags(handle.db).map((t) => [t.name, t.count])).toEqual([
      ['co-op', 1],
      ['cosy', 2]
    ])
    setGameTags(handle.db, ids[0]!, [])
    expect(listTags(handle.db).map((t) => t.name)).toEqual(['cosy'])
    expect(() => setGameTags(handle.db, ids[0]!, [''])).toThrow(/obligatoire/)
  })

  it('manages manual collections', () => {
    const col = createCollection(handle.db, 'À finir')
    expect(() => createCollection(handle.db, 'à FINIR')).toThrow(/existe déjà/)
    addToCollection(handle.db, col.id, [ids[2]!, ids[0]!, ids[2]!])
    expect(listCollections(handle.db)[0]?.gameIds).toEqual([ids[2], ids[0]])
    expect(getGame(handle.db, ids[0]!).collectionIds).toEqual([col.id])
    removeFromCollection(handle.db, col.id, ids[2]!)
    deleteGame(handle.db, ids[0]!)
    expect(listCollections(handle.db)[0]?.gameIds).toEqual([])
    expect(updateCollection(handle.db, col.id, { name: 'Backlog' }).name).toBe('Backlog')
    deleteCollection(handle.db, col.id)
    expect(listCollections(handle.db)).toEqual([])
  })

  it('validates smart rules and refuses manual additions', () => {
    const smart = createCollection(handle.db, 'Favoris installés', {
      favorite: true,
      installed: true
    })
    expect(smart.rules).toEqual({ favorite: true, installed: true })
    expect(() => addToCollection(handle.db, smart.id, [ids[0]!])).toThrow(/intelligente/)
    expect(() => validateRules({ sources: ['origin'] })).toThrow(/source/)
    expect(() => validateRules({ minPlaytimeHours: -1 })).toThrow()
    expect(updateCollection(handle.db, smart.id, { rules: null }).rules).toBeNull()
  })
})
