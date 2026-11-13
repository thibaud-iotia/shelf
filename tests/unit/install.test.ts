import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/shared/errors'
import {
  heroicInstallPath,
  legendaryFailure,
  legendaryInstallArgs,
  legendaryInstallDir,
  LegendaryInstaller,
  legendaryOwnerOf,
  parseLegendaryLine,
  type LegendaryInstall,
  type LegendaryProgress
} from '../../src/main/install/legendary'
import {
  InstallService,
  type InstallServiceDeps,
  type InstallTarget
} from '../../src/main/install/service'
import {
  readSteamDownload,
  readTail,
  SteamProgressEstimator,
  type SteamLogDownload
} from '../../src/main/install/steam-log'
import { parseProcIo, parseWriteLine } from '../../src/main/platform/process-io'
import {
  SteamInstaller,
  type SteamClientControl,
  type SteamInstallerDeps
} from '../../src/main/install/steam'
import { steamClientControl } from '../../src/main/install/steam-client'
import { installUri } from '../../src/main/sources/uris'
import {
  addLibraryFolder,
  buildLibraryFolderFile,
  buildQueuedManifest,
  installDirName,
  pickLibrary,
  readInstallState,
  readLibraryContentId
} from '../../src/main/install/steam-manifest'
import { buildLaunchPlan } from '../../src/main/launch/plan'
import { epicLauncherHas } from '../../src/main/sources/epic'
import { parseAppManifest, parseLibraryFolders } from '../../src/main/sources/steam'
import type { SteamStatus } from '../../src/main/sources/steam-running'
import { installBytesLabel, installHint, installPhaseLabel } from '../../src/shared/install'
import { tempDir } from './helpers'

const manifest = (fields: Record<string, string>) =>
  `"AppState"\n{\n${Object.entries(fields)
    .map(([k, v]) => `\t"${k}"\t\t"${v}"`)
    .join('\n')}\n}\n`

describe('Steam manifest of a queued install', () => {
  it('is read back by Shelf as "not installed yet", queued', () => {
    const text = buildQueuedManifest({ appId: 1145360, name: 'Hades', installDir: 'Hades' })
    expect(text).toContain('"StateFlags"\t\t"1026"')
    expect(parseAppManifest(text)).toMatchObject({
      appId: '1145360',
      name: 'Hades',
      installDir: 'Hades',
      installed: false
    })
    expect(readInstallState(text)).toEqual({ kind: 'queued' })
  })

  it('escapes quotes and backslashes in the name', () => {
    const text = buildQueuedManifest({ appId: 1, name: 'Say "Hi" \\o/', installDir: 'Say Hi o' })
    expect(parseAppManifest(text)?.name).toBe('Say "Hi" \\o/')
  })

  it('names the install folder after the title, without characters Windows forbids', () => {
    expect(installDirName('Half-Life 2: Episode One', 380)).toBe('Half-Life 2 Episode One')
    expect(installDirName('DOOM™ Eternal ', 782330)).toBe('DOOM Eternal')
    expect(installDirName('What?.', 9)).toBe('What')
    expect(installDirName('???', 42)).toBe('app_42')
  })

  it('tells downloading, paused and installed apart', () => {
    const base = { appid: '10', name: 'X', installdir: 'X' }
    expect(
      readInstallState(
        manifest({ ...base, StateFlags: '1026', BytesToDownload: '1000', BytesDownloaded: '250' })
      )
    ).toEqual({ kind: 'downloading', downloaded: 250, total: 1000 })
    expect(
      readInstallState(
        manifest({ ...base, StateFlags: '1538', BytesToDownload: '1000', BytesDownloaded: '500' })
      )
    ).toEqual({ kind: 'paused', downloaded: 500, total: 1000 })
    expect(readInstallState(manifest({ ...base, StateFlags: '4', buildid: '123' }))).toEqual({
      kind: 'installed'
    })
    expect(readInstallState('"libraryfolders" {}')).toBeNull()
  })

  it('picks the library with the most free space', () => {
    expect(
      pickLibrary([
        { path: 'C:/Steam', freeBytes: 10 },
        { path: 'D:/SteamLibrary', freeBytes: 500 }
      ])
    ).toBe('D:/SteamLibrary')
    expect(pickLibrary([{ path: 'C:/Steam', freeBytes: null }])).toBe('C:/Steam')
    expect(pickLibrary([])).toBeNull()
  })
})

/** A Steam root with a second library on another "disk". */
function steamRoot() {
  const root = tempDir('shelf-steam-')
  const library = tempDir('shelf-steamlib-')
  mkdirSync(join(root, 'steamapps'), { recursive: true })
  mkdirSync(join(library, 'steamapps'), { recursive: true })
  writeFileSync(
    join(root, 'steamapps', 'libraryfolders.vdf'),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${root.replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${library.replace(/\\/g, '\\\\')}"\n\t}\n}\n`
  )
  return { root, library }
}

interface FakeClient extends SteamClientControl {
  calls: string[]
  state: SteamStatus
}

function fakeClient(state: Partial<SteamStatus> = {}, quits = true): FakeClient {
  const client: FakeClient = {
    calls: [],
    state: { clientRunning: true, runningAppId: 0, updatingAppIds: [], ...state },
    status: async () => client.state,
    shutdown: async () => {
      client.calls.push('shutdown')
      if (quits) client.state = { ...client.state, clientRunning: false }
    },
    start: async () => {
      client.calls.push('start')
      client.state = { ...client.state, clientRunning: true }
    }
  }
  return client
}

/** Disks: the second library and "newdisk" folders on their own, the rest with the root. */
const fakeDisk = async (path: string) =>
  path.includes('steamlib') ? 2 : path.includes('newdisk') ? 3 : 1

function installer(
  root: string | null,
  client: SteamClientControl,
  freeBytes = (p: string) => p,
  extra: Partial<SteamInstallerDeps> = {}
) {
  return new SteamInstaller({
    root: async () => root,
    control: client,
    freeBytes: async (path) => (freeBytes(path).includes('steamlib') ? 1000 : 10),
    disk: fakeDisk,
    contentId: () => '777',
    debounceMs: 0,
    pollMs: 1,
    gamePollMs: 5,
    exitTimeoutMs: 20,
    settleMs: 0,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...extra
  })
}

describe('SteamInstaller', () => {
  it('writes the manifest in the roomiest library and restarts a running Steam once', async () => {
    const { root, library } = steamRoot()
    const client = fakeClient()
    const steam = installer(root, client)
    const phases: string[] = []
    steam.on('phase', (phase) => phases.push(phase))

    const first = await steam.queue(1145360, 'Hades')
    await steam.queue(413150, 'Stardew Valley')
    expect(first).toEqual({
      manifestPath: join(library, 'steamapps', 'appmanifest_1145360.acf'),
      existing: false
    })
    expect(readFileSync(first.manifestPath, 'utf8')).toContain('"installdir"\t\t"Hades"')

    await vi.waitFor(() => expect(client.calls).toEqual(['shutdown', 'start']))
    expect(phases).toEqual(['restarting', 'idle'])
    expect(steam.isWaiting(1145360)).toBe(false)
    steam.dispose()
  })

  it('only starts Steam when it is not running', async () => {
    const { root } = steamRoot()
    const client = fakeClient({ clientRunning: false })
    const steam = installer(root, client)
    await steam.queue(10, 'Counter-Strike')
    await vi.waitFor(() => expect(client.calls).toEqual(['start']))
    steam.dispose()
  })

  it('never interrupts a Steam game: the restart waits for it to close', async () => {
    const { root } = steamRoot()
    const client = fakeClient({ runningAppId: 570 })
    const steam = installer(root, client)
    await steam.queue(10, 'Counter-Strike')
    await vi.waitFor(() => expect(steam.phase).toBe('waitingGame'))
    expect(client.calls).toEqual([])

    client.state = { ...client.state, runningAppId: 0 }
    await vi.waitFor(() => expect(client.calls).toEqual(['shutdown', 'start']))
    steam.dispose()
  })

  it('reports the installs still waiting when Steam does not quit', async () => {
    const { root } = steamRoot()
    const steam = installer(root, fakeClient({}, false))
    const failed = vi.fn()
    steam.on('failed', failed)
    await steam.queue(10, 'Counter-Strike')
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
    expect(failed.mock.calls[0]![0]).toEqual([10])
    expect(failed.mock.calls[0]![1]).toMatch(/prochain lancement de Steam/)
    steam.dispose()
  })

  it('undoes an install until Steam has read its manifest', async () => {
    const { root } = steamRoot()
    const client = fakeClient({ runningAppId: 570 })
    const steam = installer(root, client)
    const { manifestPath } = await steam.queue(10, 'Counter-Strike')
    expect(await steam.cancel(10)).toBe(true)
    expect(existsSync(manifestPath)).toBe(false)
    steam.dispose()

    const started = installer(root, fakeClient())
    await started.queue(20, 'Team Fortress Classic')
    await vi.waitFor(() => expect(started.isWaiting(20)).toBe(false))
    expect(await started.cancel(20)).toBe(false)
    started.dispose()
  })

  it('refuses a game Steam says is installed, follows one already queued', async () => {
    const { root } = steamRoot()
    const client = fakeClient()
    const steam = installer(root, client)
    writeFileSync(
      join(root, 'steamapps', 'appmanifest_10.acf'),
      manifest({ appid: '10', name: 'CS', installdir: 'CS', StateFlags: '4', buildid: '1' })
    )
    await expect(steam.queue(10, 'CS')).rejects.toMatchObject({ code: 'VALIDATION' })

    writeFileSync(
      join(root, 'steamapps', 'appmanifest_20.acf'),
      manifest({ appid: '20', name: 'TFC', installdir: 'TFC', StateFlags: '1026' })
    )
    expect(await steam.queue(20, 'TFC')).toMatchObject({ existing: true })
    expect(steam.isWaiting(20)).toBe(false)
    steam.dispose()
  })

  it('needs Steam', async () => {
    await expect(installer(null, fakeClient()).queue(10, 'CS')).rejects.toThrow(
      'Steam est introuvable'
    )
  })
})

describe('Steam install location', () => {
  it('adds a library to libraryfolders.vdf, keeping what is there', () => {
    const text =
      '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Steam"\n\t\t"apps"\n\t\t{\n\t\t\t"10"\t\t"1"\n\t\t}\n\t}\n}\n'
    const next = addLibraryFolder(text, { root: 'C:\\Steam', path: 'E:\\Jeux', contentId: '5' })!
    expect(next.startsWith(text.slice(0, text.lastIndexOf('}')).trimEnd())).toBe(true)
    expect(parseLibraryFolders(next)).toEqual(['C:\\Steam', 'E:\\Jeux'])
    expect(next).toContain('"1"\n\t{\n\t\t"path"\t\t"E:\\\\Jeux"')
    expect(next).toContain('"contentid"\t\t"5"')
    expect(addLibraryFolder(next, { root: 'C:\\Steam', path: 'e:\\jeux\\', contentId: '6' })).toBe(
      null
    )
    expect(
      parseLibraryFolders(
        addLibraryFolder(null, { root: 'C:\\Steam', path: 'E:\\J', contentId: '5' })!
      )
    ).toEqual(['C:\\Steam', 'E:\\J'])
  })

  it('reads and writes the library marker', () => {
    expect(readLibraryContentId(buildLibraryFolderFile('123'))).toBe('123')
    expect(readLibraryContentId('"libraryfolder" { "label" "" }')).toBeNull()
  })

  it('lists the libraries there, with their free space', async () => {
    const { root, library } = steamRoot()
    expect(await installer(root, fakeClient()).libraries()).toEqual([
      { path: root, freeBytes: 10, kind: 'library' },
      { path: library, freeBytes: 1000, kind: 'library' }
    ])
  })

  it('maps a picked folder to a library like Steam does: one library per disk', async () => {
    const { root, library } = steamRoot()
    const steam = installer(root, fakeClient())
    expect(await steam.resolveFolder(library)).toEqual({
      location: { path: library, freeBytes: 1000, kind: 'library' },
      notice: null
    })
    expect((await steam.resolveFolder(join(library, 'steamapps', 'common'))).notice).toMatch(
      /fait partie de la bibliothèque/
    )
    const sameDisk = await steam.resolveFolder(tempDir('shelf-other-'))
    expect(sameDisk.location).toMatchObject({ path: root, kind: 'library' })
    expect(sameDisk.notice).toMatch(/une bibliothèque par disque/)
    const other = tempDir('shelf-newdisk-')
    expect(await steam.resolveFolder(join(other, 'Jeux'))).toEqual({
      location: { path: join(other, 'Jeux'), freeBytes: 10, kind: 'newLibrary' },
      notice: null
    })
  })

  it('installs in the library picked', async () => {
    const { root } = steamRoot()
    const steam = installer(root, fakeClient())
    const { manifestPath } = await steam.queue(10, 'CS', root)
    expect(manifestPath).toBe(join(root, 'steamapps', 'appmanifest_10.acf'))
    steam.dispose()
  })

  it('makes a new library of a folder on another disk, registered while Steam is closed', async () => {
    const { root } = steamRoot()
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    const original = readFileSync(vdf, 'utf8')
    const folder = join(tempDir('shelf-newdisk-'), 'Jeux')
    const client = fakeClient()
    let listedAtStart: string[] = []
    const start = client.start
    client.start = async () => {
      listedAtStart = parseLibraryFolders(readFileSync(vdf, 'utf8'))
      await start()
    }
    const steam = installer(root, client)

    const { manifestPath } = await steam.queue(10, 'CS', folder)
    expect(manifestPath).toBe(join(folder, 'steamapps', 'appmanifest_10.acf'))
    expect(readFileSync(join(folder, 'libraryfolder.vdf'), 'utf8')).toContain('"777"')
    // Not before Steam is closed: it rewrites the file when it quits.
    expect(readFileSync(vdf, 'utf8')).toBe(original)

    await vi.waitFor(() => expect(client.calls).toEqual(['shutdown', 'start']))
    expect(listedAtStart).toContain(folder)
    expect(readFileSync(`${vdf}.shelf-bak`, 'utf8')).toBe(original)
    steam.dispose()
  })

  it('undoes a new library when its install is cancelled, or when Steam would not quit', async () => {
    const { root } = steamRoot()
    const folder = join(tempDir('shelf-newdisk-'), 'Jeux')
    const waiting = installer(root, fakeClient({ runningAppId: 570 }))
    const { manifestPath } = await waiting.queue(10, 'CS', folder)
    expect(await waiting.cancel(10)).toBe(true)
    expect(existsSync(manifestPath)).toBe(false)
    expect(existsSync(join(folder, 'libraryfolder.vdf'))).toBe(false)
    waiting.dispose()

    const stuck = installer(root, fakeClient({}, false))
    const failed = vi.fn()
    stuck.on('failed', failed)
    await stuck.queue(20, 'TFC', folder)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(failed.mock.calls[0]).toEqual([[20], expect.stringMatching(/nouvelle bibliothèque/)])
    expect(existsSync(join(folder, 'steamapps', 'appmanifest_20.acf'))).toBe(false)
    expect(
      parseLibraryFolders(readFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'))
    ).not.toContain(folder)
    stuck.dispose()
  })

  it('says when the library picked is on a disk that is not there', async () => {
    const { root } = steamRoot()
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    const gone = join(tempDir('shelf-gone-'), 'SteamLibrary')
    writeFileSync(
      vdf,
      addLibraryFolder(readFileSync(vdf, 'utf8'), { root, path: gone, contentId: '1' })!
    )
    await expect(installer(root, fakeClient()).queue(10, 'CS', gone)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('Le disque est-il branché')
    })
  })

  it('reads Legendary’s install folder from its config.ini', () => {
    expect(legendaryInstallDir('[Legendary]\ninstall_dir = D:\\Epic\n[other]\ninstall_dir=x')).toBe(
      'D:\\Epic'
    )
    expect(legendaryInstallDir('[other]\ninstall_dir = x')).toBeNull()
  })
})

describe('Steam client control', () => {
  it('uses the executable when known, the URIs otherwise', async () => {
    const run = vi.fn(async () => {})
    const openExternal = vi.fn(async () => {})
    const status = async (): Promise<SteamStatus> => ({
      clientRunning: true,
      runningAppId: 0,
      updatingAppIds: []
    })
    const withExe = steamClientControl({
      status,
      executable: async () => 'C:/Steam/steam.exe',
      openExternal,
      run
    })
    await withExe.shutdown()
    await withExe.start()
    expect(run.mock.calls).toEqual([
      ['C:/Steam/steam.exe', ['-shutdown']],
      ['C:/Steam/steam.exe', ['-silent']]
    ])

    const viaUri = steamClientControl({ status, executable: async () => null, openExternal })
    await viaUri.shutdown()
    await viaUri.start()
    expect(openExternal.mock.calls).toEqual([['steam://exit'], ['steam://open/downloads']])
  })
})

describe('Legendary install output', () => {
  it('folds progress lines', () => {
    const empty: LegendaryProgress = { progress: null, downloadedBytes: null, totalBytes: null }
    const sized = parseLegendaryLine(
      '[cli] INFO: Download size: 1.50 GiB (Compression savings: 57.3%)',
      empty
    )!
    expect(sized.totalBytes).toBe(1.5 * 1024 ** 3)
    const progressed = parseLegendaryLine(
      '[DLManager] INFO: = Progress: 12.34% (120/970), Running for 00:00:10, ETA: 00:01:20',
      sized
    )!
    expect(progressed.progress).toBeCloseTo(0.1234)
    const downloaded = parseLegendaryLine(
      '[DLManager] INFO:  - Downloaded: 512.00 MiB, Written: 1024.00 MiB',
      progressed
    )!
    expect(downloaded.downloadedBytes).toBe(512 * 1024 ** 2)
    expect(parseLegendaryLine('[cli] INFO: Preparing download...', empty)).toBeNull()
  })

  it('keeps the last error line as the failure', () => {
    expect(
      legendaryFailure(
        '[cli] INFO: Preparing\n[cli] ERROR: Not enough available disk space! 3.2 GiB < 9.1 GiB\n[cli] INFO: bye\n'
      )
    ).toBe('Legendary a échoué : Not enough available disk space! 3.2 GiB < 9.1 GiB')
    expect(legendaryFailure('')).toBe('Legendary a échoué.')
  })

  it('installs without prompts, in Heroic’s folder for Heroic’s copy', () => {
    expect(legendaryInstallArgs('Fortnite', null)).toEqual([
      'install',
      'Fortnite',
      '--yes',
      '--skip-sdl',
      '--with-dlcs'
    ])
    expect(legendaryInstallArgs('Fortnite', 'D:/Games')).toContain('--base-path')
    expect(
      heroicInstallPath({ defaultSettings: { defaultInstallPath: 'D:\\Games\\Heroic' } })
    ).toBe('D:\\Games\\Heroic')
    expect(heroicInstallPath({})).toBeNull()
    expect(heroicInstallPath(null)).toBeNull()
  })
})

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 1234
  kill = vi.fn()
}

function legendaryWith(child: FakeChild) {
  const spawn = vi.fn(
    (_command: string, _args: string[], _options: SpawnOptions) => child as unknown as ChildProcess
  )
  const kill = vi.fn((c: ChildProcess) => (c as unknown as FakeChild).emit('close', null))
  const installer = new LegendaryInstaller({
    binaries: () => [{ file: 'legendary' }],
    runCommand: async () => JSON.stringify({ account: 'gamer' }),
    spawn,
    kill
  })
  return { installer, spawn, kill }
}

describe('LegendaryInstaller', () => {
  it('runs `legendary install` with Heroic’s config and reports progress', async () => {
    const child = new FakeChild()
    const { installer, spawn } = legendaryWith(child)
    const binary = { file: 'heroic-legendary.exe', configPath: 'C:/heroic/legendary' }
    const progress = vi.fn()
    const install = installer.start(binary, 'Sugar', 'D:/Games', progress)

    expect(spawn.mock.calls[0]![0]).toBe('heroic-legendary.exe')
    expect(spawn.mock.calls[0]![1]).toEqual(legendaryInstallArgs('Sugar', 'D:/Games'))
    const options = spawn.mock.calls[0]![2] as { env: Record<string, string> }
    expect(options.env.LEGENDARY_CONFIG_PATH).toBe('C:/heroic/legendary')

    child.stderr.write('[DLManager] INFO: = Progress: 50.00% (1/2), Running')
    child.stderr.write(' for 00:00:01, ETA: 00:00:01\n')
    await vi.waitFor(() => expect(progress).toHaveBeenCalled())
    expect(progress.mock.calls.at(-1)![0].progress).toBe(0.5)

    child.emit('close', 0)
    await expect(install.done).resolves.toBe('installed')
  })

  it('fails with Legendary’s error, stops on cancel', async () => {
    const failing = new FakeChild()
    const install = legendaryWith(failing).installer.start(
      { file: 'legendary' },
      'A',
      null,
      () => {}
    )
    failing.stderr.write('[cli] ERROR: Game is not owned\n')
    failing.emit('close', 1)
    await expect(install.done).rejects.toThrow('Legendary a échoué : Game is not owned')

    const running = new FakeChild()
    const { installer, kill } = legendaryWith(running)
    const cancelled = installer.start({ file: 'legendary' }, 'B', null, () => {})
    cancelled.cancel()
    expect(kill).toHaveBeenCalledOnce()
    await expect(cancelled.done).resolves.toBe('cancelled')
  })

  it('is available only when logged in', async () => {
    const child = new FakeChild()
    expect(await legendaryWith(child).installer.available()).toEqual({ file: 'legendary' })
    const anonymous = new LegendaryInstaller({
      binaries: () => [{ file: 'legendary' }],
      runCommand: async () => JSON.stringify({ account: '<not logged in>' })
    })
    expect(await anonymous.available()).toBeNull()
  })

  it('finds which Legendary installed a game', async () => {
    const dir = tempDir()
    const heroic = join(dir, 'heroic.json')
    writeFileSync(heroic, JSON.stringify({ Sugar: { title: 'Sugar' } }))
    const binaries = [
      { file: 'legendary', installedFile: join(dir, 'missing.json') },
      { file: 'heroic', configPath: 'cfg', installedFile: heroic }
    ]
    expect(await legendaryOwnerOf('Sugar', binaries)).toBe(binaries[1])
    expect(await legendaryOwnerOf('Other', binaries)).toBeNull()
  })
})

describe('Epic games installed through Legendary', () => {
  it('launch through Legendary when the Epic Games Launcher does not have them', async () => {
    const plan = buildLaunchPlan(
      {
        source: 'epic',
        sourceId: 'Sugar',
        executablePath: null,
        launchArgs: null,
        useRunner: false
      },
      {
        platform: 'win32',
        runnerPath: null,
        protonPrefix: '',
        legendary: { file: 'legendary.exe', configPath: 'C:/heroic/legendary' }
      }
    )
    expect(plan).toEqual({
      kind: 'launcher',
      command: 'legendary.exe',
      args: ['launch', 'Sugar'],
      uri: 'com.epicgames.launcher://apps/Sugar?action=launch&silent=true',
      env: { LEGENDARY_CONFIG_PATH: 'C:/heroic/legendary' }
    })

    const dir = tempDir()
    writeFileSync(join(dir, 'a.item'), JSON.stringify({ AppName: 'Fortnite' }))
    expect(await epicLauncherHas([dir], 'Fortnite')).toBe(true)
    expect(await epicLauncherHas([dir], 'Sugar')).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------

function fakeLegendary(binary: { file: string } | null) {
  let finish: (outcome: 'installed' | 'cancelled') => void = () => {}
  let fail: (error: Error) => void = () => {}
  let report: (progress: LegendaryProgress) => void = () => {}
  const handle: LegendaryInstall = {
    done: new Promise((resolve, reject) => {
      finish = resolve
      fail = reject
    }),
    cancel: vi.fn(() => finish('cancelled'))
  }
  const legendary = {
    available: vi.fn(async () => binary),
    basePath: vi.fn(async () => null),
    start: vi.fn((_b, _app, _base, onProgress: (p: LegendaryProgress) => void) => {
      report = onProgress
      return handle
    }),
    dispose: vi.fn()
  }
  return {
    legendary: legendary as unknown as LegendaryInstaller,
    handle,
    finish: (o: 'installed' | 'cancelled') => finish(o),
    fail: (e: Error) => fail(e),
    report: (p: LegendaryProgress) => report(p),
    mock: legendary
  }
}

function service(options: {
  root?: string | null
  client?: SteamClientControl
  legendary?: LegendaryInstaller
  enabled?: boolean
  defaultPath?: string | null
  live?: Pick<InstallServiceDeps, 'steamLog' | 'steamWrites'>
}) {
  const steam = installer(options.root ?? null, options.client ?? fakeClient())
  const deps = {
    ...options.live,
    steam,
    legendary: options.legendary ?? fakeLegendary(null).legendary,
    enabled: () => options.enabled ?? true,
    defaultPath: () => options.defaultPath ?? null,
    freeBytes: async () => 42,
    openExternal: vi.fn(async (_uri: string) => {}),
    refresh: vi.fn(async () => {}),
    onChange: vi.fn(),
    onEnded: vi.fn(),
    pollMs: 5,
    missingGraceMs: 10
  }
  return { installs: new InstallService(deps), deps, steam }
}

const hades: InstallTarget = { id: 1, title: 'Hades', source: 'steam', sourceId: '1145360' }
const sugar: InstallTarget = { id: 2, title: 'Sugar', source: 'epic', sourceId: 'Sugar' }

describe('InstallService', () => {
  it('installs a Steam game in the background and follows it until Steam is done', async () => {
    const { root, library } = steamRoot()
    const { installs, deps } = service({ root })
    expect(await installs.install(hades)).toEqual({ mode: 'background' })
    expect(installs.list()[0]).toMatchObject({ gameId: 1, source: 'steam' })
    await expect(installs.install(hades)).rejects.toThrow('déjà en cours')

    const file = join(library, 'steamapps', 'appmanifest_1145360.acf')
    await vi.waitFor(() => expect(installs.list()[0]?.phase).toBe('queued'))
    writeFileSync(
      file,
      manifest({
        appid: '1145360',
        name: 'Hades',
        installdir: 'Hades',
        StateFlags: '1026',
        BytesToDownload: '400',
        BytesDownloaded: '100'
      })
    )
    await vi.waitFor(() =>
      expect(installs.list()[0]).toMatchObject({ phase: 'downloading', progress: 0.25 })
    )

    writeFileSync(
      file,
      manifest({
        appid: '1145360',
        name: 'Hades',
        installdir: 'Hades',
        StateFlags: '4',
        buildid: '9'
      })
    )
    await vi.waitFor(() => expect(deps.onEnded).toHaveBeenCalledWith(hades, 'installed', undefined))
    expect(deps.refresh).toHaveBeenCalled()
    expect(installs.list()).toEqual([])
    expect(deps.openExternal).not.toHaveBeenCalled()
    installs.dispose()
  })

  it('reports a game Steam dropped (not on the logged-in account)', async () => {
    const { root, library } = steamRoot()
    const { installs, deps } = service({ root })
    await installs.install(hades)
    await vi.waitFor(() => expect(installs.list()[0]?.phase).toBe('queued'))
    const { rmSync } = await import('node:fs')
    rmSync(join(library, 'steamapps', 'appmanifest_1145360.acf'))
    await vi.waitFor(() =>
      expect(deps.onEnded).toHaveBeenCalledWith(
        hades,
        'failed',
        expect.stringContaining('compte Steam connecté')
      )
    )
    installs.dispose()
  })

  it('opens the launcher when the setting is off, or when Steam’s library cannot be written', async () => {
    const off = service({ root: steamRoot().root, enabled: false })
    expect(await off.installs.install(hades)).toEqual({ mode: 'launcher' })
    expect(off.deps.openExternal).toHaveBeenCalledWith('steam://install/1145360')

    const missing = service({ root: null })
    expect(await missing.installs.install(hades)).toEqual({ mode: 'launcher' })
    expect(missing.deps.openExternal).toHaveBeenCalledWith('steam://install/1145360')

    // GOG goes through its launcher: Galaxy on Windows/macOS, Heroic on Linux (CI runs both).
    const gog = service({})
    const gogGame = { id: 3, title: 'X', source: 'gog' as const, sourceId: '1' }
    await gog.installs.install(gogGame)
    expect(gog.deps.openExternal).toHaveBeenCalledWith(installUri(gogGame))
  })

  it('cancels a Steam install before Steam reads it, refuses afterwards', async () => {
    const { root } = steamRoot()
    const waiting = service({ root, client: fakeClient({ runningAppId: 570 }) })
    await waiting.installs.install(hades)
    await vi.waitFor(() =>
      expect(waiting.installs.list()[0]).toMatchObject({ phase: 'waitingGame', cancellable: true })
    )
    await waiting.installs.cancel(1)
    expect(waiting.deps.onEnded).toHaveBeenCalledWith(hades, 'cancelled', undefined)
    waiting.installs.dispose()

    const started = service({ root: steamRoot().root })
    await started.installs.install(hades)
    await vi.waitFor(() => expect(started.installs.list()[0]?.phase).toBe('queued'))
    await expect(started.installs.cancel(1)).rejects.toThrow(
      'annulez le téléchargement depuis Steam'
    )
    started.installs.dispose()
  })

  it('installs an Epic game through Legendary, or opens the launcher without it', async () => {
    const fake = fakeLegendary({ file: 'legendary' })
    const { installs, deps } = service({ legendary: fake.legendary })
    expect(await installs.install(sugar)).toEqual({ mode: 'background' })
    expect(installs.list()[0]).toMatchObject({ phase: 'preparing', cancellable: true })
    fake.report({ progress: 0.4, downloadedBytes: 40, totalBytes: 100 })
    expect(installs.list()[0]).toMatchObject({ phase: 'downloading', progress: 0.4 })
    fake.finish('installed')
    await vi.waitFor(() => expect(deps.onEnded).toHaveBeenCalledWith(sugar, 'installed', undefined))
    expect(deps.refresh).toHaveBeenCalled()

    const failing = fakeLegendary({ file: 'legendary' })
    const second = service({ legendary: failing.legendary })
    await second.installs.install(sugar)
    failing.fail(new AppError('UNAVAILABLE', 'Legendary a échoué : Game is not owned'))
    await vi.waitFor(() =>
      expect(second.deps.onEnded).toHaveBeenCalledWith(
        sugar,
        'failed',
        'Legendary a échoué : Game is not owned'
      )
    )

    const cancelled = fakeLegendary({ file: 'legendary' })
    const third = service({ legendary: cancelled.legendary })
    await third.installs.install(sugar)
    await third.installs.cancel(2)
    await vi.waitFor(() =>
      expect(third.deps.onEnded).toHaveBeenCalledWith(sugar, 'cancelled', undefined)
    )

    const none = service({ legendary: fakeLegendary(null).legendary })
    expect(await none.installs.install(sugar)).toEqual({ mode: 'launcher' })
    expect(none.deps.openExternal).toHaveBeenCalledWith(
      expect.stringMatching(/^(com\.epicgames\.launcher|heroic):\/\//)
    )
    expect(none.installs.list()).toEqual([])
  })

  it('follows again the Steam installs queued before Shelf quit', async () => {
    const { root } = steamRoot()
    writeFileSync(
      join(root, 'steamapps', 'appmanifest_1145360.acf'),
      manifest({
        appid: '1145360',
        name: 'Hades',
        installdir: 'Hades',
        StateFlags: '1026',
        BytesToDownload: '10',
        BytesDownloaded: '5'
      })
    )
    const { installs, deps } = service({ root })
    await installs.resume([hades, { ...hades, id: 9, sourceId: '999' }])
    expect(installs.list()).toEqual([
      expect.objectContaining({ gameId: 1, phase: 'downloading', progress: 0.5 })
    ])
    expect(deps.onChange).toHaveBeenCalled()
    installs.dispose()
  })

  it('offers Steam’s libraries, the saved default pre-selected, and installs where asked', async () => {
    const { root, library } = steamRoot()
    const auto = service({ root })
    expect(await auto.installs.locations('steam')).toMatchObject({
      source: 'steam',
      defaultPath: library,
      locations: [{ path: root }, { path: library }]
    })
    expect(await auto.installs.locations('gog')).toBeNull()

    const saved = service({ root, defaultPath: root })
    expect((await saved.installs.locations('steam'))?.defaultPath).toBe(root)
    await saved.installs.install(hades)
    expect(existsSync(join(root, 'steamapps', 'appmanifest_1145360.acf'))).toBe(true)

    const asked = service({ root: steamRoot().root, defaultPath: root })
    const other = steamRoot()
    const picked = service({ root: other.root })
    await picked.installs.install(hades, { path: other.root })
    expect(existsSync(join(other.root, 'steamapps', 'appmanifest_1145360.acf'))).toBe(true)
    for (const s of [auto, saved, asked, picked]) s.installs.dispose()

    expect(await service({ root, enabled: false }).installs.locations('steam')).toBeNull()
  })

  it('offers Epic folders through Legendary, and installs in the folder picked', async () => {
    const fake = fakeLegendary({ file: 'legendary' })
    fake.mock.basePath.mockResolvedValue('C:/Games/Heroic' as never)
    const { installs } = service({ legendary: fake.legendary, defaultPath: 'E:/Epic' })
    expect(await installs.locations('epic')).toEqual({
      source: 'epic',
      defaultPath: 'E:/Epic',
      locations: [
        { path: 'E:/Epic', freeBytes: 42, kind: 'folder' },
        { path: 'C:/Games/Heroic', freeBytes: 42, kind: 'folder' }
      ]
    })
    await installs.install(sugar, { path: 'F:/Jeux' })
    await vi.waitFor(() => expect(fake.mock.start).toHaveBeenCalled())
    expect(fake.mock.start.mock.calls[0]![2]).toBe('F:/Jeux')
    expect(await installs.pickedFolder('epic', 'F:/Jeux')).toEqual({
      location: { path: 'F:/Jeux', freeBytes: 42, kind: 'folder' },
      notice: null
    })
    installs.dispose()

    expect(
      await service({ legendary: fakeLegendary(null).legendary }).installs.locations('epic')
    ).toBeNull()
  })
})

// Lines as Steam writes them (content_log.txt), Hades in place of the real app.
const contentLog = (appId: number, ...events: string[]) =>
  events.map((event, i) => `[2026-11-13 16:58:${10 + i}] AppID ${appId} ${event}`).join('\n')

const STARTED = (download: number, stage: number) =>
  `update started : download ${download}/4000, store 0/0, reuse 0/0, delta 0/0, stage ${stage}/6000 `

describe('Steam download progress', () => {
  it('reads the run Steam is downloading from its content log', () => {
    const log = [
      contentLog(
        1145360,
        'App update changed : Running Update,Preallocating,',
        STARTED(0, 0),
        'App update changed : Running Update,Downloading,Staging,'
      ),
      contentLog(570, STARTED(0, 0)),
      '[2026-11-13 16:59:00] stats: (SteamCache, 447) cache12-par1.steamcontent.com: 1 Bytes'
    ].join('\n')
    expect(readSteamDownload(log, 1145360)).toEqual({
      run: '2026-11-13 16:58:11',
      downloaded: 0,
      total: 4000,
      staged: 0,
      stageTotal: 6000,
      active: true,
      step: 'downloading'
    })
    expect(readSteamDownload(log, 42)).toBeNull()

    const paused = `${log}\n${contentLog(1145360, 'update canceled : Disabled (Suspended)')}`
    expect(readSteamDownload(paused, 1145360)?.active).toBe(false)
    const resumed = `${paused}\n${contentLog(1145360, STARTED(1000, 1500))}`
    expect(readSteamDownload(resumed, 1145360)).toMatchObject({ staged: 1500, active: true })
    const committing = `${resumed}\n${contentLog(1145360, 'App update changed : Running Update,Committing,')}`
    expect(readSteamDownload(committing, 1145360)?.step).toBe('finishing')
    const done = `${committing}\n${contentLog(1145360, 'finished update, 1 mounted depots (BuildID 9) : 1145361 (1),')}`
    expect(readSteamDownload(done, 1145360)?.active).toBe(false)

    const preallocating = contentLog(1145360, 'App update changed : Running Update,Preallocating,')
    expect(readSteamDownload(preallocating, 1145360)).toMatchObject({
      active: true,
      step: 'preallocating'
    })
  })

  it('reads only the tail of a long log, from a line start', async () => {
    const file = join(tempDir('shelf-log-'), 'content_log.txt')
    writeFileSync(file, `${'x'.repeat(100)}\nsecond\nthird\n`)
    expect(await readTail(file, 10)).toBe('third\n')
    expect(await readTail(file, 1000)).toContain('second')
    expect(await readTail(join(file, 'missing'))).toBeNull()
  })

  it('follows the bytes Steam writes between two log lines, never backwards', () => {
    const run: SteamLogDownload = {
      run: 'a',
      downloaded: 0,
      total: 4000,
      staged: 0,
      stageTotal: 6000,
      active: true,
      step: 'downloading'
    }
    const estimator = new SteamProgressEstimator()
    expect(estimator.estimate(run, { pid: 7, written: 50_000 })).toBe(0)
    expect(estimator.estimate(run, { pid: 7, written: 51_500 })).toBe(0.25)
    // Paused: the log goes back to the start of the run; the bar stays.
    expect(estimator.estimate({ ...run, active: false }, null)).toBe(0.25)
    expect(estimator.atLeast(0.3)).toBe(0.3)
    // Resumed in a restarted Steam: new run, new process, counted from the log's checkpoint.
    const resumed = { ...run, run: 'b', downloaded: 2000, staged: 3000 }
    expect(estimator.estimate(resumed, { pid: 9, written: 10 })).toBe(0.5)
    expect(estimator.estimate(resumed, { pid: 9, written: 10_000 })).toBe(0.99)
    expect(estimator.estimate({ ...resumed, step: 'finishing' }, null)).toBe(0.99)
  })

  it('reads the write counters of the Steam process', () => {
    expect(parseWriteLine('14840 2750339394\r')).toEqual({ pid: 14840, written: 2750339394 })
    expect(parseWriteLine('-')).toBeNull()
    expect(parseProcIo('rchar: 10\nwchar: 20\nwrite_bytes: 4096\n')).toBe(4096)
    expect(parseProcIo('')).toBeNull()
  })

  it('shows a Steam download moving while the appmanifest still says 0 %', async () => {
    const { root, library } = steamRoot()
    let log = ''
    let written = 1_000_000
    const live = {
      steamLog: async () => log,
      steamWrites: { sample: async () => ({ pid: 1, written }), stop: vi.fn() }
    }
    const { installs, deps } = service({ root, live })
    await installs.install(hades)
    await vi.waitFor(() => expect(installs.list()[0]?.phase).toBe('queued'))

    // Steam took the install over: manifest at 0, the content log knows more.
    writeFileSync(
      join(library, 'steamapps', 'appmanifest_1145360.acf'),
      manifest({ appid: '1145360', StateFlags: '1026', BytesToDownload: '4000' })
    )
    log = contentLog(1145360, 'App update changed : Running Update,Preallocating,')
    await vi.waitFor(() => expect(installs.list()[0]?.phase).toBe('allocating'))
    log = contentLog(1145360, STARTED(0, 0), 'App update changed : Running Update,Downloading,')
    await vi.waitFor(() =>
      expect(installs.list()[0]).toMatchObject({ phase: 'downloading', totalBytes: 4000 })
    )
    written += 3000
    await vi.waitFor(() =>
      expect(installs.list()[0]).toMatchObject({ progress: 0.5, downloadedBytes: 2000 })
    )
    installs.dispose()
    expect(live.steamWrites.stop).toHaveBeenCalled()
    expect(deps.onEnded).not.toHaveBeenCalled()
  })
})

describe('install wording', () => {
  const base = {
    gameId: 1,
    startedAt: 0,
    downloadedBytes: null,
    totalBytes: null,
    cancellable: false
  }
  it('reads like the launcher would say it', () => {
    expect(
      installPhaseLabel({ ...base, source: 'steam', phase: 'restarting', progress: null })
    ).toBe('Redémarrage de Steam…')
    expect(
      installPhaseLabel({ ...base, source: 'epic', phase: 'downloading', progress: 0.427 })
    ).toBe('Téléchargement 42 %')
    expect(installBytesLabel({ downloadedBytes: 1024 ** 3, totalBytes: 4 * 1024 ** 3 })).toBe(
      '1,0 Go / 4,0 Go'
    )
    expect(installHint({ source: 'steam', phase: 'waitingGame', startedAt: 0 }, 0)).toMatch(
      /quand il sera fermé/
    )
    expect(installHint({ source: 'steam', phase: 'queued', startedAt: 0 }, 1_000)).toBeNull()
    expect(installHint({ source: 'steam', phase: 'queued', startedAt: 0 }, 200_000)).toMatch(
      /file de Steam/
    )
  })
})
