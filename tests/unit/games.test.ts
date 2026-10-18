import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import {
  closeSession,
  createManualGame,
  deleteGame,
  discardUnfinishedSessions,
  getGame,
  getGameDetail,
  listGames,
  openSession,
  updateGame
} from '../../src/main/games/repository'
import { normalizeTitle, titleFromExecutable } from '../../src/main/games/titles'
import { validateGameInput, validateGamePatch } from '../../src/main/games/validation'
import { SettingsStore } from '../../src/main/settings/store'

const migrationsFolder = resolve(__dirname, '../../drizzle')
const exe = process.execPath // any existing file

describe('games repository', () => {
  let handle: DatabaseHandle
  beforeEach(() => (handle = openDatabase(':memory:', migrationsFolder)))
  afterEach(() => handle.close())

  const create = (title = 'Celeste') =>
    createManualGame(handle.db, validateGameInput({ title, executablePath: exe }))

  it('creates a manual game with a UUID and its folder', () => {
    const game = create()
    expect(game).toMatchObject({
      title: 'Celeste',
      source: 'manual',
      ownership: 'manual',
      installState: 'installed',
      installPath: dirname(exe),
      playtimeSec: 0,
      lastPlayedAt: null,
      tags: [],
      canInstall: false
    })
    expect(game.sourceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('lists games by title, case-insensitively', () => {
    create('zelda')
    create('Celeste')
    create('hades')
    expect(listGames(handle.db).map((g) => g.title)).toEqual(['Celeste', 'hades', 'zelda'])
  })

  it('updates and deletes', () => {
    const game = create()
    expect(updateGame(handle.db, game.id, { favorite: true, title: 'Celeste DX' })).toMatchObject({
      favorite: true,
      title: 'Celeste DX'
    })
    deleteGame(handle.db, game.id)
    expect(() => getGame(handle.db, game.id)).toThrow(/n’existe plus/)
  })

  it('aggregates finished sessions only', () => {
    const game = create()
    const t0 = new Date('2026-10-01T20:00:00Z')
    const s1 = openSession(handle.db, game.id, t0)
    closeSession(handle.db, s1, new Date(t0.getTime() + 3600_000))
    const t1 = new Date('2026-10-02T20:00:00Z')
    const s2 = openSession(handle.db, game.id, t1)
    closeSession(handle.db, s2, new Date(t1.getTime() + 1200_000))
    openSession(handle.db, game.id, new Date('2026-10-03T20:00:00Z')) // still running

    const stats = getGame(handle.db, game.id)
    expect(stats).toMatchObject({
      playtimeSec: 4800,
      sessionCount: 2,
      lastPlayedAt: t1.getTime(),
      lastSessionSec: 1200
    })
    expect(getGameDetail(handle.db, game.id).sessions.map((s) => s.durationSec)).toEqual([
      1200, 3600
    ])
    expect(listGames(handle.db)[0]?.playtimeSec).toBe(4800)

    expect(discardUnfinishedSessions(handle.db)).toBe(1)
  })
})

describe('validation', () => {
  it('requires a title and an existing absolute executable', () => {
    expect(() => validateGameInput({ title: ' ', executablePath: exe })).toThrow(/titre/)
    expect(() => validateGameInput({ title: 'A', executablePath: 'game.exe' })).toThrow(/absolu/)
    expect(() =>
      validateGameInput({ title: 'A', executablePath: resolve(__dirname, 'nope.exe') })
    ).toThrow(/introuvable/)
    expect(validateGameInput({ title: ' A ', executablePath: exe, launchArgs: '' })).toEqual({
      title: 'A',
      executablePath: exe,
      launchArgs: null,
      installPath: null
    })
  })

  it('validates patches field by field', () => {
    expect(validateGamePatch({ favorite: true, genres: [' RPG ', ''] })).toEqual({
      favorite: true,
      genres: ['RPG']
    })
    expect(() => validateGamePatch({ favorite: 'yes' })).toThrow()
    expect(() => validateGamePatch({ releaseDate: '17/09/2020' })).toThrow(/AAAA/)
  })
})

describe('titleFromExecutable', () => {
  it.each([
    ['D:\\Games\\Hollow\\hollow_knight.exe', 'Hollow Knight'],
    ['/games/DeadCells/DeadCells.x86_64', 'Dead Cells'],
    ['C:\\Games\\Doom\\doom-x64.exe', 'Doom']
  ])('%s → %s', (path, title) => {
    expect(titleFromExecutable(path)).toBe(title)
  })

  it('normalizes titles for de-duplication', () => {
    expect(normalizeTitle('DOOM (2016)™')).toBe(normalizeTitle('Doom 2016'))
    expect(normalizeTitle('The Witcher 3: Wild Hunt')).toBe(normalizeTitle('Witcher 3 Wild Hunt'))
    expect(normalizeTitle('Pokémon')).toBe('pokemon')
  })
})

describe('settings store', () => {
  let handle: DatabaseHandle
  beforeEach(() => (handle = openDatabase(':memory:', migrationsFolder)))
  afterEach(() => handle.close())

  it('returns defaults, persists validated values', () => {
    const store = new SettingsStore(handle.db)
    expect(store.get('coverSize')).toBe('md')
    store.update({ coverSize: 'lg', scanFolders: ['D:\\Games', 'D:\\Games', ' '] })
    expect(store.all()).toMatchObject({ coverSize: 'lg', scanFolders: ['D:\\Games'] })
    expect(() => store.update({ coverSize: 'xl' })).toThrow()
    expect(() => store.update({ nope: 1 })).toThrow(/inconnu/)
  })
})
