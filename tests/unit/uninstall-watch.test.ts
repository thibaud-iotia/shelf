import { describe, expect, it, vi } from 'vitest'
import { UninstallWatcher, type WatchedGameState } from '../../src/main/games/uninstall-watch'

function setup(initial: Record<number, WatchedGameState | null>, existing: string[] = []) {
  const rows = new Map(Object.entries(initial).map(([id, row]) => [Number(id), row]))
  let now = 0
  const deps = {
    refresh: vi.fn(async () => {}),
    state: (id: number) => rows.get(id) ?? null,
    markUninstalled: vi.fn((id: number) => {
      const row = rows.get(id)
      if (row) rows.set(id, { ...row, installState: 'not_installed' })
    }),
    onUninstalled: vi.fn(),
    exists: (path: string) => existing.includes(path),
    timeoutMs: 1000,
    now: () => now
  }
  const watcher = new UninstallWatcher(deps)
  return { watcher, deps, rows, advance: (ms: number) => (now += ms) }
}

describe('UninstallWatcher', () => {
  it('re-reads the launchers until the game is seen uninstalled', async () => {
    const { watcher, deps, rows } = setup({
      1: { installState: 'installed', executablePath: null }
    })
    watcher.watch(1)

    await watcher.poll()
    expect(deps.refresh).toHaveBeenCalledTimes(1)
    expect(deps.onUninstalled).not.toHaveBeenCalled()
    expect(watcher.watching()).toEqual([1])

    rows.set(1, { installState: 'not_installed', executablePath: null })
    await watcher.poll()
    expect(deps.onUninstalled).toHaveBeenCalledWith(1)
    expect(watcher.watching()).toEqual([])

    await watcher.poll()
    expect(deps.refresh).toHaveBeenCalledTimes(2)
    watcher.dispose()
  })

  it('marks a manual game uninstalled once its executable is gone', async () => {
    const { watcher, deps } = setup(
      { 2: { installState: 'installed', executablePath: 'C:/Games/Foo/Foo.exe' } },
      ['C:/Games/Foo/Foo.exe']
    )
    watcher.watch(2)
    await watcher.poll()
    expect(deps.markUninstalled).not.toHaveBeenCalled()

    const gone = setup({ 2: { installState: 'installed', executablePath: 'C:/Games/Foo/Foo.exe' } })
    gone.watcher.watch(2)
    await gone.watcher.poll()
    expect(gone.deps.markUninstalled).toHaveBeenCalledWith(2)
    expect(gone.deps.onUninstalled).toHaveBeenCalledWith(2)
    watcher.dispose()
    gone.watcher.dispose()
  })

  it('gives up after the timeout or when the game left the library', async () => {
    const { watcher, deps, rows, advance } = setup({
      1: { installState: 'installed', executablePath: null },
      2: { installState: 'installed', executablePath: null }
    })
    watcher.watch(1)
    watcher.watch(2)
    rows.set(2, null)
    await watcher.poll()
    expect(watcher.watching()).toEqual([1])

    advance(1001)
    await watcher.poll()
    expect(watcher.watching()).toEqual([])
    expect(deps.onUninstalled).not.toHaveBeenCalled()
  })

  it('keeps watching when a refresh fails', async () => {
    const { watcher, deps } = setup({ 1: { installState: 'installed', executablePath: null } })
    deps.refresh.mockRejectedValueOnce(new Error('locked'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    watcher.watch(1)
    await watcher.poll()
    expect(watcher.watching()).toEqual([1])
    warn.mockRestore()
    watcher.dispose()
  })
})
