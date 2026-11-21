import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdateMode, AppUpdateState } from '../../src/shared/models'
import type { AttemptStore, InstallAttempt } from '../../src/main/updates/attempt'
import {
  compareVersions,
  manualDownloadUrl,
  RELEASES_URL,
  UpdateService,
  updateMode,
  type FoundUpdate,
  type UpdaterAdapter
} from '../../src/main/updates/service'
import { parseSimulation } from '../../src/main/updates/simulated'

const FOUND: FoundUpdate = {
  version: '1.4.0',
  files: ['Shelf-1.4.0-win-x64.exe', 'Shelf-1.4.0-mac-arm64.dmg', 'Shelf-1.4.0-linux-amd64.deb']
}

function fakeAdapter(overrides: Partial<UpdaterAdapter> = {}) {
  return {
    check: vi.fn(async (): Promise<FoundUpdate | null> => FOUND),
    download: vi.fn(async (onProgress: (percent: number) => void) => {
      onProgress(12.4)
      onProgress(12.6)
      onProgress(100)
    }),
    install: vi.fn(),
    ...overrides
  }
}

function service(
  adapter: UpdaterAdapter | null,
  mode: AppUpdateMode = 'auto',
  extra: { enabled?: () => boolean; platform?: NodeJS.Platform; attempts?: AttemptStore } = {}
) {
  const states: AppUpdateState[] = []
  const openExternal = vi.fn(async () => {})
  const updates = new UpdateService({
    adapter,
    mode,
    currentVersion: '1.3.0',
    platform: extra.platform ?? 'win32',
    enabled: extra.enabled ?? (() => true),
    onChange: (state) => states.push(state),
    openExternal,
    attempts: extra.attempts,
    now: () => 1_000
  })
  return { updates, states, openExternal }
}

/** In-memory install attempt, as the file in userData would keep it. */
function memoryAttempts(initial: InstallAttempt | null = null) {
  let saved = initial
  return {
    read: () => saved,
    write: (attempt: InstallAttempt | null) => {
      saved = attempt
    },
    get saved() {
      return saved
    }
  }
}

/** Lets the background download finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('updateMode', () => {
  it('installs in place on Windows and AppImage, links the installer elsewhere', () => {
    expect(updateMode({ packaged: false, platform: 'win32' })).toBe('disabled')
    expect(updateMode({ packaged: true, platform: 'win32' })).toBe('auto')
    expect(updateMode({ packaged: true, platform: 'linux', appImage: '/x/Shelf.AppImage' })).toBe(
      'auto'
    )
    expect(updateMode({ packaged: true, platform: 'linux' })).toBe('manual')
    expect(updateMode({ packaged: true, platform: 'darwin' })).toBe('manual')
    expect(updateMode({ packaged: true, platform: 'freebsd' })).toBe('disabled')
  })
})

describe('manualDownloadUrl', () => {
  it("opens this install's installer, the release page when there is none", () => {
    const url = (file: string) => `${RELEASES_URL}/download/v1.4.0/${file}`
    expect(manualDownloadUrl(FOUND, 'darwin', 'manual')).toBe(url('Shelf-1.4.0-mac-arm64.dmg'))
    expect(manualDownloadUrl(FOUND, 'linux', 'manual')).toBe(url('Shelf-1.4.0-linux-amd64.deb'))
    expect(manualDownloadUrl(FOUND, 'win32', 'auto')).toBe(url('Shelf-1.4.0-win-x64.exe'))
    // AppImage install, but the release has no AppImage: its page.
    expect(manualDownloadUrl(FOUND, 'linux', 'auto')).toBe(`${RELEASES_URL}/tag/v1.4.0`)
    expect(manualDownloadUrl({ version: '1.4.0', files: [] }, 'darwin', 'manual')).toBe(
      `${RELEASES_URL}/tag/v1.4.0`
    )
  })
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1)
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0)
    expect(compareVersions('1.3.0', '1.4.0')).toBe(-1)
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(0)
  })
})

describe('parseSimulation', () => {
  it('reads "<version>" and "manual:<version>"', () => {
    expect(parseSimulation('9.9.9')).toEqual({ mode: 'auto', version: '9.9.9' })
    expect(parseSimulation('manual:9.9.9')).toEqual({ mode: 'manual', version: '9.9.9' })
    expect(parseSimulation(undefined)).toBeNull()
    expect(parseSimulation('latest')).toBeNull()
  })
})

describe('UpdateService', () => {
  it('downloads a new version in the background, then waits for the restart', async () => {
    const adapter = fakeAdapter()
    const { updates, states } = service(adapter)

    const afterCheck = await updates.check()
    expect(afterCheck).toMatchObject({ phase: 'downloading', version: '1.4.0', percent: 0 })
    await settle()

    expect(states.map((s) => s.phase)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'downloading',
      'downloading',
      'ready'
    ])
    // Rounded, and the same percentage is not pushed twice while downloading.
    expect(states.map((s) => s.percent)).toEqual([null, 0, 12, 13, 100, 100])
    expect(updates.getState()).toMatchObject({
      phase: 'ready',
      currentVersion: '1.3.0',
      releaseUrl: `${RELEASES_URL}/tag/v1.4.0`,
      checkedAt: 1_000
    })

    updates.install()
    expect(adapter.install).toHaveBeenCalledOnce()
  })

  it('does not look again once an update is downloaded', async () => {
    const adapter = fakeAdapter()
    const { updates } = service(adapter)
    await updates.check()
    await settle()
    await updates.check()
    expect(adapter.check).toHaveBeenCalledOnce()
  })

  it('shares a check already running', async () => {
    const adapter = fakeAdapter({ check: vi.fn(async () => null) })
    const { updates } = service(adapter)
    const [a, b] = await Promise.all([updates.check(), updates.check()])
    expect(adapter.check).toHaveBeenCalledOnce()
    expect(a.phase).toBe('up-to-date')
    expect(b.phase).toBe('up-to-date')
  })

  it('only announces the version in manual mode and opens its installer', async () => {
    const adapter = fakeAdapter()
    const { updates, openExternal } = service(adapter, 'manual', { platform: 'darwin' })
    expect(await updates.check()).toMatchObject({ phase: 'available', version: '1.4.0' })
    expect(adapter.download).not.toHaveBeenCalled()
    expect(() => updates.install()).toThrow('Aucune mise à jour prête')

    await updates.openDownload()
    expect(openExternal).toHaveBeenCalledWith(
      `${RELEASES_URL}/download/v1.4.0/Shelf-1.4.0-mac-arm64.dmg`
    )
  })

  it('keeps errors as a state, in French, first line only', async () => {
    const adapter = fakeAdapter({
      check: vi.fn(async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED\n<html>…</html>')
      })
    })
    const { updates } = service(adapter)
    expect(await updates.check()).toMatchObject({
      phase: 'error',
      error: 'Impossible de vérifier les mises à jour : net::ERR_INTERNET_DISCONNECTED'
    })
  })

  it('reports a failed download', async () => {
    const adapter = fakeAdapter({
      download: vi.fn(async () => {
        throw new Error('sha512 checksum mismatch')
      })
    })
    const { updates } = service(adapter)
    await updates.check()
    await settle()
    expect(updates.getState()).toMatchObject({
      phase: 'error',
      error: 'Échec du téléchargement de la mise à jour : sha512 checksum mismatch'
    })
    // A later check starts over.
    await updates.check()
    expect(adapter.check).toHaveBeenCalledTimes(2)
  })

  it('remembers the version it restarts on', async () => {
    const attempts = memoryAttempts()
    const { updates } = service(fakeAdapter(), 'auto', { attempts })
    await updates.check()
    await settle()
    updates.install()
    expect(attempts.saved).toEqual({ version: '1.4.0', files: FOUND.files, at: 1_000 })
  })

  it('next startup on the new version: installed, the note is cleared', () => {
    const attempts = memoryAttempts({ version: '1.3.0', files: FOUND.files, at: 1 })
    const { updates } = service(fakeAdapter(), 'auto', { attempts })
    expect(updates.getState().lastInstall).toEqual({ version: '1.3.0', outcome: 'installed' })
    expect(attempts.saved).toBeNull()
  })

  it('next startup still on the old version: blocked, the installer can be downloaded', async () => {
    const attempts = memoryAttempts({ version: '1.4.0', files: FOUND.files, at: 1 })
    const { updates, states, openExternal } = service(fakeAdapter(), 'auto', { attempts })
    expect(updates.getState()).toMatchObject({
      phase: 'idle',
      lastInstall: { version: '1.4.0', outcome: 'failed' },
      releaseUrl: `${RELEASES_URL}/tag/v1.4.0`
    })
    expect(attempts.saved).toBeNull()

    await updates.openDownload()
    expect(openExternal).toHaveBeenCalledWith(
      `${RELEASES_URL}/download/v1.4.0/Shelf-1.4.0-win-x64.exe`
    )

    expect(updates.dismiss().lastInstall).toBeNull()
    expect(states.at(-1)?.lastInstall).toBeNull()
  })

  it('refuses to check in a development build', async () => {
    const { updates } = service(null, 'disabled')
    await expect(updates.check()).rejects.toThrow('version de développement')
  })

  it('checks automatically only while the setting is on', async () => {
    vi.useFakeTimers()
    let enabled = false
    const adapter = fakeAdapter({ check: vi.fn(async () => null) })
    const { updates } = service(adapter, 'auto', { enabled: () => enabled })
    updates.start(1_000, 10_000)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(adapter.check).not.toHaveBeenCalled()

    enabled = true
    await vi.advanceTimersByTimeAsync(10_000)
    expect(adapter.check).toHaveBeenCalledOnce()

    updates.dispose()
    await vi.advanceTimersByTimeAsync(50_000)
    expect(adapter.check).toHaveBeenCalledOnce()
  })
})
