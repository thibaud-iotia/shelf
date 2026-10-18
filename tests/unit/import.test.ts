import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type DatabaseHandle } from '../../src/main/db/client'
import { games } from '../../src/main/db/schema'
import { buildCandidates } from '../../src/main/import/candidates'
import { ImportService } from '../../src/main/import/service'
import { SettingsStore } from '../../src/main/settings/store'
import type { DetectedGame, GameSource } from '../../src/main/sources/types'

const migrationsFolder = resolve(__dirname, '../../drizzle')
const gamesFolder = resolve(__dirname, '../fixtures/folders/Games')

function fakeSource(id: GameSource['id'], found: DetectedGame[] | Error): GameSource {
  return {
    id,
    name: id,
    locate: async () => (found instanceof Error ? null : `/fake/${id}`),
    scan: async () => {
      if (found instanceof Error) throw found
      return found
    }
  }
}

const hades: DetectedGame = {
  source: 'steam',
  sourceId: '1145360',
  title: 'Hades',
  installPath: 'C:\\Steam\\steamapps\\common\\Hades',
  executablePath: null
}
const celeste: DetectedGame = {
  source: 'epic',
  sourceId: 'Salt',
  title: 'Celeste',
  installPath: 'C:\\Epic\\Celeste',
  executablePath: 'C:\\Epic\\Celeste\\Celeste.exe'
}

describe('buildCandidates', () => {
  it('classifies launcher and folder finds', () => {
    const existing = [
      {
        id: 1,
        title: 'Doom',
        source: 'steam',
        sourceId: '379720',
        executablePath: null,
        installPath: null
      },
      {
        id: 2,
        title: 'Hades',
        source: 'steam',
        sourceId: '1145360',
        executablePath: null,
        installPath: null
      }
    ] as Parameters<typeof buildCandidates>[2]
    const candidates = buildCandidates(
      [hades, celeste],
      [
        {
          path: 'D:\\Games\\Doom\\game_x64.exe',
          folder: 'D:\\Games\\Doom',
          title: 'Doom',
          excludedReason: null
        },
        {
          path: 'D:\\Games\\Hollow\\Hollow.exe',
          folder: 'D:\\Games\\Hollow',
          title: 'Hollow',
          excludedReason: null
        },
        {
          path: 'D:\\Games\\Hollow\\unins000.exe',
          folder: 'D:\\Games\\Hollow',
          title: 'Hollow',
          excludedReason: 'uninstall'
        },
        {
          path: 'D:\\Games\\Celeste\\Celeste.exe',
          folder: 'D:\\Games\\Celeste',
          title: 'Celeste',
          excludedReason: null
        },
        {
          path: 'C:\\Epic\\Celeste\\Tools\\Editor.exe',
          folder: 'C:\\Epic',
          title: 'Editor',
          excludedReason: null
        }
      ],
      existing
    )
    const summary = candidates.map((c) => [
      c.title,
      c.status,
      c.needsReview,
      c.duplicateOf?.id ?? c.excludedReason
    ])
    expect(summary).toEqual([
      ['Hades', 'update', false, null],
      ['Celeste', 'new', false, null],
      ['Doom', 'duplicate', true, 1],
      ['Hollow', 'new', true, null],
      ['Hollow', 'excluded', true, 'uninstall'],
      ['Celeste', 'excluded', true, 'déjà détecté via Epic']
    ])
  })
})

describe('ImportService', () => {
  let handle: DatabaseHandle
  let settings: SettingsStore
  beforeEach(() => {
    handle = openDatabase(':memory:', migrationsFolder)
    settings = new SettingsStore(handle.db)
  })
  afterEach(() => handle.close())

  it('reports launcher status and isolates a failing source', async () => {
    const service = new ImportService(handle.db, settings, [
      fakeSource('steam', [hades]),
      fakeSource('epic', new Error('manifest illisible'))
    ])
    const launchers = await service.launchers()
    expect(launchers.map((l) => [l.source, l.available, l.gameCount])).toEqual([
      ['steam', true, 1],
      ['epic', false, 0]
    ])
    const scan = await service.scan({ folders: [] })
    expect(scan.candidates.map((c) => c.title)).toEqual(['Hades'])
    expect(scan.errors).toEqual([{ source: 'epic', message: 'epic : manifest illisible' }])
  })

  it('imports, merges, ignores, then marks removed launcher games', async () => {
    const imported: number[] = []
    const steam = { found: [hades] as DetectedGame[] }
    const service = new ImportService(
      handle.db,
      settings,
      [{ ...fakeSource('steam', []), scan: async () => steam.found }],
      (list) => imported.push(...list.map((g) => g.id))
    )
    handle.db
      .insert(games)
      .values({
        title: 'Doom',
        source: 'steam',
        sourceId: '379720',
        ownership: 'owned',
        installState: 'not_installed'
      })
      .returning()
      .get()

    const scan = await service.scan({ folders: [gamesFolder] })
    const byTitle = (title: string, status?: string) =>
      scan.candidates.find((c) => c.title === title && (!status || c.status === status))!
    expect(byTitle('Doom').status).toBe('duplicate')

    const report = service.apply([
      { key: byTitle('Hades').key, action: 'import' },
      { key: byTitle('Hollow', 'new').key, action: 'import', title: 'Hollow Knight', igdbId: 1234 },
      { key: byTitle('Doom').key, action: 'merge' },
      { key: byTitle('Retro Pack').key, action: 'ignore' }
    ])
    expect(report).toEqual({
      imported: 2,
      updated: 0,
      merged: 1,
      ignored: 1,
      markedNotInstalled: 0
    })

    const rows = handle.db.select().from(games).all()
    expect(rows.map((r) => [r.title, r.source, r.installState]).sort()).toEqual([
      ['Doom', 'steam', 'installed'],
      ['Hades', 'steam', 'installed'],
      ['Hollow Knight', 'manual', 'installed']
    ])
    expect(rows.find((r) => r.title === 'Doom')?.executablePath).toBe(
      join(gamesFolder, 'Doom', 'game_x64.exe')
    )
    expect(rows.find((r) => r.title === 'Hollow Knight')?.igdbId).toBe(1234)
    expect(imported).toHaveLength(3)
    expect(() => service.apply([])).toThrow(/détection/)

    // Hades uninstalled from Steam: a refresh marks it, without duplicating anything.
    steam.found = []
    const refresh = await service.refreshInstalled()
    expect(refresh?.markedNotInstalled).toBe(1) // Hades; Doom keeps its merged executable
    expect(handle.db.select().from(games).where(eq(games.title, 'Hades')).get()?.installState).toBe(
      'not_installed'
    )
    expect(handle.db.select().from(games).all()).toHaveLength(3)
  })

  it('skips disabled launchers', async () => {
    settings.update({ enabledLaunchers: ['epic'] })
    const service = new ImportService(handle.db, settings, [fakeSource('steam', [hades])])
    expect((await service.scan({ folders: [] })).candidates).toEqual([])
  })
})
