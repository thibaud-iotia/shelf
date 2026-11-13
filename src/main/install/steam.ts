import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError } from '../../shared/errors'
import { exists, readText } from '../sources/fs'
import { libraryPaths } from '../sources/steam'
import type { SteamStatus } from '../sources/steam-running'
import { diskFree, diskOf } from './disk'
import {
  addLibraryFolder,
  buildLibraryFolderFile,
  buildQueuedManifest,
  installDirName,
  isInside,
  manifestFileName,
  pickLibrary,
  readInstallState,
  readLibraryContentId,
  samePath
} from './steam-manifest'

/** How Shelf drives the Steam client (see `steamClientControl`). */
export interface SteamClientControl {
  /** `appIds`: installs waiting, so the Windows registry reader also reads the client pid. */
  status: (appIds: number[]) => Promise<SteamStatus>
  /** Asks the running Steam to quit (`steam.exe -shutdown`, `steam://exit`). */
  shutdown: () => Promise<void>
  /** Starts Steam in the tray: it reads the manifests and starts the queued downloads. */
  start: () => Promise<void>
}

/** What the Steam client is going through for the installs Shelf queued. */
export type SteamClientPhase = 'idle' | 'restarting' | 'waitingGame'

export interface SteamInstallerDeps {
  root: () => Promise<string | null>
  control: SteamClientControl
  freeBytes?: (path: string) => Promise<number | null>
  /** Disk (volume) of a folder: Steam keeps one library per disk. */
  disk?: (path: string) => Promise<number | null>
  /** Id written in a new library's `libraryfolder.vdf`. */
  contentId?: () => string
  /** Groups installs clicked in a row into a single restart. */
  debounceMs?: number
  /** Polling of the client state while it quits, and while a Steam game runs. */
  pollMs?: number
  gamePollMs?: number
  /** How long Steam may take to quit before Shelf gives up. */
  exitTimeoutMs?: number
  /** Pause between Steam gone and Steam started again (its helpers exit last). */
  settleMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface QueuedSteamInstall {
  manifestPath: string
  /** The manifest existed already (install queued before, Steam downloading it). */
  existing: boolean
}

/** A place Steam can install to: one of its libraries, or a folder Shelf adds as a library. */
export interface SteamLibraryChoice {
  path: string
  freeBytes: number | null
  kind: 'library' | 'newLibrary'
}

interface Pending {
  manifestPath: string
  /** Request number when the manifest was written: picked up by Steam once started after it. */
  seq: number
  /** New library the manifest is in (registered in Steam at its next restart). */
  library: string | null
}

interface NewLibrary {
  path: string
  contentId: string
  /** Shelf wrote its `libraryfolder.vdf` (removed again if the install is cancelled). */
  created: boolean
}

const randomContentId = () => BigInt.asUintN(63, randomBytes(8).readBigUInt64BE()).toString()

async function writeAtomic(file: string, content: string): Promise<void> {
  // Written aside then renamed: Steam never reads half a file.
  const temp = `${file}.shelf-tmp`
  await writeFile(temp, content, 'utf8')
  await rename(temp, file)
}

/**
 * Installs Steam games without Steam's install dialog: writes the manifest of a queued install
 * in the library chosen (the one with the most free space by default), then starts Steam in
 * the tray — or restarts it, since Steam reads manifests only at startup. A folder that is not
 * a library yet becomes one, as Steam › Storage › "Add drive" does: registered in
 * `libraryfolders.vdf` while Steam is closed for the restart. A Steam game running is never interrupted:
 * the restart waits for it to close. Emits `phase` as the client goes through these steps and
 * `failed` with the app ids still waiting when Steam would not quit.
 */
export class SteamInstaller extends EventEmitter<{
  phase: [SteamClientPhase]
  failed: [number[], string]
}> {
  private readonly pending = new Map<number, Pending>()
  private readonly newLibraries: NewLibrary[] = []
  private seq = 0
  /** Requests up to this number were written before Steam last started. */
  private startedSeq = 0
  private current: SteamClientPhase = 'idle'
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private disposed = false
  private readonly freeBytes: (path: string) => Promise<number | null>
  private readonly disk: (path: string) => Promise<number | null>
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: SteamInstallerDeps) {
    super()
    this.freeBytes = deps.freeBytes ?? diskFree
    this.disk = deps.disk ?? diskOf
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  get phase(): SteamClientPhase {
    return this.current
  }

  /** Whether Steam has not read the manifest of `appId` yet (its install can still be undone). */
  isWaiting(appId: number): boolean {
    const entry = this.pending.get(appId)
    return !!entry && entry.seq > this.startedSeq
  }

  /** Manifest of `appId` in one of the libraries, null when Steam has none. */
  async findManifest(appId: number): Promise<string | null> {
    const root = await this.deps.root()
    if (!root) return null
    for (const library of await libraryPaths(root)) {
      const file = join(library, 'steamapps', manifestFileName(appId))
      if (await exists(file)) return file
    }
    return null
  }

  /** Steam's libraries on a disk that is there, with their free space. */
  async libraries(): Promise<SteamLibraryChoice[]> {
    const root = await this.deps.root()
    if (!root) return []
    const out: SteamLibraryChoice[] = []
    for (const path of await libraryPaths(root)) {
      if (await exists(join(path, 'steamapps'))) {
        out.push({ path, freeBytes: await this.freeBytes(path), kind: 'library' })
      }
    }
    return out
  }

  /**
   * Where a game goes for a folder the user picked: the library it is in, the library already
   * on its disk (Steam keeps one per disk, `notice` says so), or the folder as a new library.
   */
  async resolveFolder(
    folder: string
  ): Promise<{ location: SteamLibraryChoice; notice: string | null }> {
    const root = await this.deps.root()
    if (!root) throw new AppError('UNAVAILABLE', 'Steam est introuvable sur cet ordinateur.')
    const known = await libraryPaths(root)
    const library = async (path: string): Promise<SteamLibraryChoice> => ({
      path,
      freeBytes: await this.freeBytes(path),
      kind: 'library'
    })

    const containing = known.find((path) => isInside(folder, path))
    if (containing) {
      if (!(await exists(join(containing, 'steamapps')))) {
        throw new AppError(
          'VALIDATION',
          `Bibliothèque Steam introuvable : ${containing}. Le disque est-il branché ?`
        )
      }
      return {
        location: await library(containing),
        notice: samePath(containing, folder)
          ? null
          : `Ce dossier fait partie de la bibliothèque Steam ${containing} : le jeu y sera installé.`
      }
    }
    const pendingLibrary = this.newLibraries.find((entry) => isInside(folder, entry.path))
    const disk = pendingLibrary ? null : await this.disk(folder)
    if (disk !== null) {
      for (const path of known) {
        if (!(await exists(join(path, 'steamapps'))) || (await this.disk(path)) !== disk) continue
        return {
          location: await library(path),
          notice: `Steam n’accepte qu’une bibliothèque par disque : le jeu ira dans ${path}.`
        }
      }
    }
    const path = pendingLibrary?.path ?? folder
    return {
      location: { path, freeBytes: await this.freeBytes(path), kind: 'newLibrary' },
      notice: null
    }
  }

  /**
   * Queues the install of `appId` and gets Steam to pick it up. `folder`: where to install
   * (see `resolveFolder`); the library with the most free space when not given.
   */
  async queue(appId: number, title: string, folder?: string): Promise<QueuedSteamInstall> {
    const root = await this.deps.root()
    if (!root) throw new AppError('UNAVAILABLE', 'Steam est introuvable sur cet ordinateur.')

    const known = await this.findManifest(appId)
    if (known) {
      const text = await readText(known)
      const state = text ? readInstallState(text) : null
      if (state?.kind === 'installed') {
        throw new AppError('VALIDATION', 'Steam indique que ce jeu est déjà installé.')
      }
      // Already queued or downloading: Steam has it, no restart needed.
      if (state) return { manifestPath: known, existing: true }
    }

    let library: string
    let newLibrary: string | null = null
    if (folder) {
      const { location } = await this.resolveFolder(folder)
      library = location.path
      if (location.kind === 'newLibrary') newLibrary = await this.prepareLibrary(location.path)
    } else {
      library = pickLibrary(await this.libraries()) ?? root
    }
    const steamapps = join(library, 'steamapps')
    const manifestPath = join(steamapps, manifestFileName(appId))
    // A broken manifest elsewhere: Steam must not see the app twice.
    if (known && !samePath(known, manifestPath)) await rm(known, { force: true })
    const content = buildQueuedManifest({
      appId,
      name: title,
      installDir: installDirName(title, appId)
    })
    try {
      await mkdir(steamapps, { recursive: true })
      await writeAtomic(manifestPath, content)
    } catch (error) {
      throw new AppError(
        'UNAVAILABLE',
        `Impossible d’écrire dans la bibliothèque Steam (${steamapps}) : ${(error as Error).message}`
      )
    }
    this.pending.set(appId, { manifestPath, seq: ++this.seq, library: newLibrary })
    this.schedule(this.deps.debounceMs ?? 1_500)
    return { manifestPath, existing: false }
  }

  /** Makes `path` a library folder on disk; registered in Steam at the next restart. */
  private async prepareLibrary(path: string): Promise<string> {
    const known = this.newLibraries.find((entry) => samePath(entry.path, path))
    if (known) return known.path
    const marker = join(path, 'libraryfolder.vdf')
    const text = await readText(marker)
    const existingId = text ? readLibraryContentId(text) : null
    const contentId = existingId ?? (this.deps.contentId ?? randomContentId)()
    try {
      await mkdir(join(path, 'steamapps'), { recursive: true })
      if (!existingId) await writeAtomic(marker, buildLibraryFolderFile(contentId))
    } catch (error) {
      throw new AppError(
        'VALIDATION',
        `Impossible de créer une bibliothèque Steam dans ${path} : ${(error as Error).message}`
      )
    }
    this.newLibraries.push({ path, contentId, created: !existingId })
    return path
  }

  /** Drops a new library no install uses any more (undoing what Shelf wrote). */
  private async dropLibrary(path: string): Promise<void> {
    if ([...this.pending.values()].some((entry) => entry.library === path)) return
    const index = this.newLibraries.findIndex((entry) => entry.path === path)
    if (index < 0) return
    const [entry] = this.newLibraries.splice(index, 1)
    if (!entry?.created) return
    await rm(join(path, 'libraryfolder.vdf'), { force: true })
    await rmdir(join(path, 'steamapps')).catch(() => {})
  }

  /** Adds the new libraries to `libraryfolders.vdf`; Steam is closed. */
  private async registerLibraries(root: string, libraries: NewLibrary[]): Promise<void> {
    const files = [
      join(root, 'config', 'libraryfolders.vdf'),
      join(root, 'steamapps', 'libraryfolders.vdf')
    ]
    const present: string[] = []
    for (const file of files) if (await exists(file)) present.push(file)
    for (const library of libraries) {
      this.newLibraries.splice(this.newLibraries.indexOf(library), 1)
      try {
        for (const file of present.length ? present : [files[1]!]) {
          const text = await readText(file)
          const next = addLibraryFolder(text, { root, ...library })
          if (next === null) continue
          // Steam's own copy kept once, should anything go wrong.
          if (text && !(await exists(`${file}.shelf-bak`))) {
            await writeFile(`${file}.shelf-bak`, text, 'utf8')
          }
          await writeAtomic(file, next)
        }
      } catch (error) {
        console.warn('[steam-install] library registration failed', error)
        this.newLibraries.push(library)
        await this.abandon(
          library.path,
          `Impossible d’ajouter la bibliothèque Steam ${library.path} : ${(error as Error).message}`
        )
      }
    }
  }

  /** Gives up the installs queued in a new library (manifests removed): `failed`. */
  private async abandon(library: string, message: string): Promise<void> {
    const ids: number[] = []
    for (const [appId, entry] of [...this.pending]) {
      if (entry.library !== library) continue
      ids.push(appId)
      this.pending.delete(appId)
      await rm(entry.manifestPath, { force: true })
    }
    await this.dropLibrary(library)
    if (ids.length) this.emit('failed', ids, message)
  }

  /** Undoes a queued install Steam has not read yet; false when Steam already has it. */
  async cancel(appId: number): Promise<boolean> {
    const entry = this.pending.get(appId)
    if (!entry || entry.seq <= this.startedSeq) {
      this.pending.delete(appId)
      return false
    }
    this.pending.delete(appId)
    await rm(entry.manifestPath, { force: true })
    if (entry.library) await this.dropLibrary(entry.library)
    return true
  }

  /** Steam installed (or dropped) the game: nothing more to do for it. */
  forget(appId: number): void {
    this.pending.delete(appId)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private setPhase(phase: SteamClientPhase): void {
    if (this.current === phase) return
    this.current = phase
    this.emit('phase', phase)
  }

  private schedule(delay: number): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.kick()
    }, delay)
  }

  private waitingIds(): number[] {
    return [...this.pending]
      .filter(([, entry]) => entry.seq > this.startedSeq)
      .map(([appId]) => appId)
  }

  /** Gets Steam to read the manifests written since it last started. */
  private async kick(): Promise<void> {
    if (this.busy || this.disposed) return
    const waiting = this.waitingIds()
    if (waiting.length === 0) {
      this.setPhase('idle')
      return
    }
    this.busy = true
    try {
      const { control } = this.deps
      const status = await control.status(waiting)
      if (status.clientRunning && (status.runningAppId ?? 0) > 0) {
        // Never interrupt a game: try again once it is closed.
        this.setPhase('waitingGame')
        this.schedule(this.deps.gamePollMs ?? 10_000)
        return
      }
      if (status.clientRunning) {
        this.setPhase('restarting')
        await control.shutdown()
        if (!(await this.waitForExit(waiting))) {
          this.setPhase('idle')
          // New libraries can only be added while Steam is closed.
          for (const library of [...this.newLibraries]) {
            await this.abandon(
              library.path,
              'Steam ne s’est pas fermé : la nouvelle bibliothèque n’a pas pu être ajoutée. Réessayez l’installation.'
            )
          }
          const left = waiting.filter((appId) => this.pending.has(appId))
          if (left.length) {
            this.emit(
              'failed',
              left,
              'Steam ne s’est pas fermé : l’installation démarrera au prochain lancement de Steam.'
            )
          }
          // Still on disk: Steam reads them whenever it starts.
          this.startedSeq = this.seq
          return
        }
        await this.sleep(this.deps.settleMs ?? 2_000)
      }
      // Taken together: an install queued from here on gets another round.
      const target = this.seq
      const libraries = this.newLibraries.filter((library) =>
        [...this.pending.values()].some(
          (entry) => entry.library === library.path && entry.seq <= target
        )
      )
      const root = libraries.length ? await this.deps.root() : null
      if (root) await this.registerLibraries(root, libraries)
      await control.start()
      this.startedSeq = target
      this.setPhase('idle')
    } catch (error) {
      console.warn('[steam-install] restart failed', error)
      this.setPhase('idle')
      this.startedSeq = this.seq
      this.emit('failed', waiting, 'Impossible de démarrer Steam.')
    } finally {
      this.busy = false
      // Manifests written while Steam was starting: another round.
      if (!this.disposed && this.waitingIds().length > 0 && !this.timer) {
        this.schedule(this.deps.debounceMs ?? 1_500)
      }
    }
  }

  private async waitForExit(appIds: number[]): Promise<boolean> {
    const pollMs = this.deps.pollMs ?? 1_000
    const attempts = Math.max(1, Math.ceil((this.deps.exitTimeoutMs ?? 60_000) / pollMs))
    for (let i = 0; i < attempts; i++) {
      await this.sleep(pollMs)
      const status = await this.deps.control.status(appIds)
      if (status.clientRunning === false) return true
    }
    return false
  }
}
