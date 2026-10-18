import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { backupFileName, exportSaves } from '../../src/main/saves/backup'
import { FIXTURES, tempDir } from './helpers'

// system.ts imports electron; only its pure helper is tested here.
vi.mock('electron', () => ({ app: {}, BrowserWindow: {}, Menu: {}, nativeImage: {}, Tray: {} }))
const { autostartDesktopEntry, HIDDEN_ARG } = await import('../../src/main/system')

describe('save backups', () => {
  it('zips a save folder recursively with "/" paths', () => {
    const target = join(tempDir(), 'celeste.zip')
    const result = exportSaves(join(FIXTURES, 'saves', 'Celeste'), target)
    expect(result).toMatchObject({ path: target, files: 3 })
    const entries = unzipSync(readFileSync(target))
    expect(Object.keys(entries).sort()).toEqual([
      '0.celeste',
      'settings.celeste',
      'slots/slot1.dat'
    ])
    expect(strFromU8(entries['0.celeste']!)).toContain('<Deaths>1337</Deaths>')
  })

  it('reports a missing or empty folder', () => {
    expect(() => exportSaves(join(FIXTURES, 'nope'), join(tempDir(), 'x.zip'))).toThrow(
      /introuvable/
    )
    expect(() => exportSaves(tempDir(), join(tempDir(), 'x.zip'))).toThrow(/vide/)
  })

  it('builds a safe file name', () => {
    expect(backupFileName('Hades: Edition <Spéciale>', new Date('2026-10-18T12:00:00Z'))).toBe(
      'Hades Edition Spéciale-saves-2026-10-18.zip'
    )
    expect(backupFileName('???')).toMatch(/^jeu-saves-/)
  })
})

describe('autostart', () => {
  it('writes an XDG entry that starts hidden', () => {
    const entry = autostartDesktopEntry('/opt/Shelf/shelf')
    expect(entry).toContain('[Desktop Entry]')
    expect(entry).toContain(`Exec="/opt/Shelf/shelf" ${HIDDEN_ARG}`)
  })
})
