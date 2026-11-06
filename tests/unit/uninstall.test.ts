import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findUninstaller, mayUninstall, uninstallPlan } from '../../src/main/sources/uninstall'
import { tempDir } from './helpers'

function gameFolder(files: string[]): string {
  const dir = tempDir()
  for (const file of files) writeFileSync(join(dir, file), '')
  return dir
}

describe('uninstall', () => {
  it('uses the Steam URI whatever the folder holds', () => {
    const game = { source: 'steam' as const, sourceId: '620', installPath: null }
    expect(mayUninstall(game, 'linux')).toBe(true)
    expect(uninstallPlan(game, 'linux')).toEqual({ kind: 'uri', uri: 'steam://uninstall/620' })
  })

  it('finds the Inno Setup uninstaller of a GOG game on Windows', () => {
    const dir = gameFolder(['Witcher3.exe', 'unins001.exe', 'unins000.exe', 'unins000.dat'])
    mkdirSync(join(dir, 'uninstall.exe'))
    const game = { source: 'gog' as const, sourceId: '1207664663', installPath: dir }
    expect(mayUninstall(game, 'win32')).toBe(true)
    expect(uninstallPlan(game, 'win32')).toEqual({
      kind: 'program',
      path: join(dir, 'unins000.exe')
    })
  })

  it('finds an uninstaller in a manual game folder', () => {
    const dir = gameFolder(['Game.exe', 'Uninstall.exe'])
    expect(findUninstaller(dir, 'win32')).toBe(join(dir, 'Uninstall.exe'))
  })

  it('has no plan without an uninstaller, a folder or a supported source', () => {
    const empty = gameFolder(['Game.exe'])
    expect(uninstallPlan({ source: 'manual', sourceId: 'x', installPath: empty }, 'win32')).toBe(
      null
    )
    expect(mayUninstall({ source: 'manual', sourceId: 'x', installPath: empty }, 'win32')).toBe(
      true
    )
    expect(mayUninstall({ source: 'manual', sourceId: 'x', installPath: null }, 'win32')).toBe(
      false
    )
    expect(
      mayUninstall({ source: 'epic', sourceId: 'Fortnite', installPath: empty }, 'win32')
    ).toBe(false)
    expect(findUninstaller(join(empty, 'missing'), 'win32')).toBe(null)
  })

  it('does not run uninstallers outside Windows', () => {
    const dir = gameFolder(['uninstall.exe'])
    const game = { source: 'gog' as const, sourceId: '1', installPath: dir }
    expect(mayUninstall(game, 'linux')).toBe(false)
    expect(uninstallPlan(game, 'darwin')).toBe(null)
  })
})
