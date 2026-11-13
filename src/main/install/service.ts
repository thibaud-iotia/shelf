import type { GameSourceId } from '../../shared/domain'
import { AppError } from '../../shared/errors'
import { isInstallSource } from '../../shared/install'
import type {
  InstallLocation,
  InstallLocations,
  InstallPhase,
  InstallProgress,
  InstallRequest,
  InstallSource,
  InstallStart,
  PickedInstallFolder
} from '../../shared/models'
import type { ProcessWriteMeter } from '../platform/process-io'
import { readText } from '../sources/fs'
import { installUri } from '../sources/uris'
import { diskFree } from './disk'
import type { LegendaryInstall, LegendaryInstaller, LegendaryProgress } from './legendary'
import { pickLibrary, readInstallState, samePath } from './steam-manifest'
import type { SteamInstaller } from './steam'
import { readSteamDownload, SteamProgressEstimator, type SteamLogDownload } from './steam-log'

export interface InstallTarget {
  id: number
  title: string
  source: GameSourceId
  sourceId: string
}

export type InstallOutcome = 'installed' | 'failed' | 'cancelled'

export interface InstallServiceDeps {
  steam: SteamInstaller
  legendary: LegendaryInstaller
  /** Réglage « installer en arrière-plan ». */
  enabled: () => boolean
  /** Default location saved in the settings for a launcher (null: Shelf picks). */
  defaultPath: (source: InstallSource) => string | null
  freeBytes?: (path: string) => Promise<number | null>
  openExternal: (uri: string) => Promise<void>
  /** Re-reads the launchers' files (install states). */
  refresh: () => Promise<void>
  onChange: (installs: InstallProgress[]) => void
  onEnded: (game: InstallTarget, outcome: InstallOutcome, error?: string) => void
  /** Tail of Steam's content log: live state of its downloads. */
  steamLog?: () => Promise<string | null>
  /** Write counter of the Steam client: the bytes of a download between two log lines. */
  steamWrites?: ProcessWriteMeter
  /** Polling of the Steam manifests while installs are followed. */
  pollMs?: number
  /** How long a manifest may be missing before the install counts as dropped by Steam. */
  missingGraceMs?: number
  now?: () => number
}

interface SteamEntry {
  kind: 'steam'
  appId: number
  manifestPath: string
  missingSince: number | null
  estimator: SteamProgressEstimator
}

interface EpicEntry {
  kind: 'epic'
  handle: LegendaryInstall | null
}

type Entry = { game: InstallTarget; progress: InstallProgress } & (SteamEntry | EpicEntry)

const steamEntry = (appId: number, manifestPath: string): SteamEntry => ({
  kind: 'steam',
  appId,
  manifestPath,
  missingSince: null,
  estimator: new SteamProgressEstimator()
})

const steamAppId = (sourceId: string): number | null =>
  /^\d{1,10}$/.test(sourceId) ? Number(sourceId) : null

/**
 * Installs owned games without the launcher's window when it can: Steam (manifest + restart in
 * the tray, see SteamInstaller) and Epic through a logged-in Legendary. Follows them until the
 * game is installed — the library is then re-read — and opens the launcher's install page
 * otherwise (setting off, other launchers, Legendary missing).
 */
export class InstallService {
  private readonly entries = new Map<number, Entry>()
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private readonly now: () => number

  constructor(private readonly deps: InstallServiceDeps) {
    this.now = deps.now ?? Date.now
    deps.steam.on('phase', () => void this.pollSteam())
    deps.steam.on('failed', (appIds, message) => {
      for (const entry of [...this.entries.values()]) {
        if (entry.kind === 'steam' && appIds.includes(entry.appId)) {
          this.end(entry, 'failed', message)
        }
      }
    })
  }

  list(): InstallProgress[] {
    return [...this.entries.values()].map((entry) => entry.progress)
  }

  /** Where a background install of `source` may go; null when it would open the launcher. */
  async locations(source: string): Promise<InstallLocations | null> {
    if (!this.deps.enabled()) return null
    const saved = isInstallSource(source) ? this.deps.defaultPath(source) : null
    if (source === 'steam') {
      const locations: InstallLocation[] = await this.deps.steam.libraries()
      if (!locations.length) return null
      const known = saved ? locations.find((l) => samePath(l.path, saved)) : undefined
      return {
        source,
        locations,
        defaultPath: known?.path ?? pickLibrary(locations) ?? locations[0]!.path
      }
    }
    if (source === 'epic') {
      const binary = await this.deps.legendary.available()
      if (!binary) return null
      const fallback = await this.deps.legendary.basePath(binary)
      const paths: string[] = []
      for (const path of [saved, fallback]) {
        if (path && !paths.some((p) => samePath(p, path))) paths.push(path)
      }
      if (!paths.length) return null
      const free = this.deps.freeBytes ?? diskFree
      const locations: InstallLocation[] = []
      for (const path of paths) {
        locations.push({ path, freeBytes: await free(path), kind: 'folder' })
      }
      return { source, locations, defaultPath: paths[0]! }
    }
    return null
  }

  /** A folder picked for installs of `source`, as the launcher will use it. */
  async pickedFolder(source: string, path: string): Promise<PickedInstallFolder> {
    if (source === 'steam') return this.deps.steam.resolveFolder(path)
    if (source === 'epic') {
      const free = this.deps.freeBytes ?? diskFree
      return { location: { path, freeBytes: await free(path), kind: 'folder' }, notice: null }
    }
    throw new AppError('VALIDATION', 'Ce launcher ne permet pas de choisir l’emplacement.')
  }

  async install(game: InstallTarget, request: InstallRequest = {}): Promise<InstallStart> {
    if (this.entries.has(game.id)) {
      throw new AppError('VALIDATION', 'L’installation de ce jeu est déjà en cours.')
    }
    if (this.deps.enabled() && isInstallSource(game.source)) {
      const path = request.path ?? this.deps.defaultPath(game.source) ?? undefined
      if (game.source === 'steam' && (await this.installSteam(game, path))) {
        return { mode: 'background' }
      }
      if (game.source === 'epic' && (await this.installEpic(game, path))) {
        return { mode: 'background' }
      }
    }
    const uri = installUri(game)
    if (!uri) throw new AppError('NOT_FOUND', 'Ce jeu ne peut pas être installé depuis Shelf.')
    await this.deps.openExternal(uri)
    return { mode: 'launcher' }
  }

  /** Steam installs queued before Shelf last quit (manifest still waiting or downloading). */
  async resume(games: InstallTarget[]): Promise<void> {
    for (const game of games) {
      const appId = steamAppId(game.sourceId)
      if (game.source !== 'steam' || appId === null || this.entries.has(game.id)) continue
      const manifestPath = await this.deps.steam.findManifest(appId)
      const text = manifestPath ? await readText(manifestPath) : null
      const state = text ? readInstallState(text) : null
      if (!manifestPath || !state || state.kind === 'installed') continue
      this.track(game, steamEntry(appId, manifestPath), 'queued')
    }
    if (this.entries.size) await this.pollSteam()
  }

  /** Stops an install; refused when the launcher already took it over (Steam downloading). */
  async cancel(gameId: number): Promise<void> {
    const entry = this.entries.get(gameId)
    if (!entry) return
    if (entry.kind === 'epic') {
      if (entry.handle) entry.handle.cancel()
      else this.end(entry, 'cancelled')
      return
    }
    if (!(await this.deps.steam.cancel(entry.appId))) {
      throw new AppError(
        'VALIDATION',
        'Steam a déjà pris en charge ce jeu : annulez le téléchargement depuis Steam.'
      )
    }
    this.end(entry, 'cancelled')
  }

  dispose(): void {
    this.stopTimer()
    this.entries.clear()
    this.deps.legendary.dispose()
    this.deps.steam.dispose()
  }

  private async installSteam(game: InstallTarget, path: string | undefined): Promise<boolean> {
    const appId = steamAppId(game.sourceId)
    if (appId === null) return false
    let manifestPath: string
    try {
      ;({ manifestPath } = await this.deps.steam.queue(appId, game.title, path))
    } catch (error) {
      // Already installed according to Steam: say so. Anything else: Steam's own dialog.
      if (error instanceof AppError && error.code === 'VALIDATION') throw error
      console.warn('[install] Steam manifest failed, opening Steam', error)
      return false
    }
    this.track(game, steamEntry(appId, manifestPath), 'preparing')
    void this.pollSteam()
    return true
  }

  private async installEpic(game: InstallTarget, path: string | undefined): Promise<boolean> {
    const { legendary } = this.deps
    // Shown at once: Legendary takes a few seconds to answer.
    const entry = this.track<EpicEntry>(game, { kind: 'epic', handle: null }, 'preparing')
    const binary = await legendary.available()
    // Cancelled while Legendary answered.
    if (this.entries.get(game.id) !== entry) return true
    if (!binary) {
      // No logged-in Legendary: the Epic Games Launcher's page instead.
      this.entries.delete(game.id)
      this.emitChange()
      return false
    }
    const basePath = path ?? (await legendary.basePath(binary))
    const handle = legendary.start(binary, game.sourceId, basePath, (progress) =>
      this.updateEpic(entry, progress)
    )
    entry.handle = handle
    entry.progress = { ...entry.progress, cancellable: true }
    this.emitChange()
    handle.done.then(
      async (outcome) => {
        if (outcome === 'installed') await this.refreshQuietly()
        this.end(entry, outcome)
      },
      (error: unknown) =>
        this.end(entry, 'failed', error instanceof Error ? error.message : String(error))
    )
    return true
  }

  private updateEpic(entry: Entry, progress: LegendaryProgress): void {
    if (this.entries.get(entry.game.id) !== entry) return
    entry.progress = {
      ...entry.progress,
      phase: 'downloading',
      progress: progress.progress,
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes
    }
    this.emitChange()
  }

  private track<T extends SteamEntry | EpicEntry>(
    game: InstallTarget,
    kind: T,
    phase: InstallPhase
  ): Entry & T {
    const entry = {
      game,
      progress: {
        gameId: game.id,
        source: game.source,
        phase,
        progress: null,
        downloadedBytes: null,
        totalBytes: null,
        startedAt: this.now(),
        cancellable: false
      },
      ...kind
    } as Entry & T
    this.entries.set(game.id, entry)
    if (entry.kind === 'steam') {
      this.timer ??= setInterval(() => void this.pollSteam(), this.deps.pollMs ?? 1_000)
    }
    this.emitChange()
    return entry
  }

  /** Reads the manifests of the Steam installs followed: phase, progress, done. */
  private async pollSteam(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      const { steam } = this.deps
      const live = new SteamLive(this.deps)
      for (const entry of [...this.entries.values()]) {
        if (entry.kind !== 'steam') continue
        const text = await readText(entry.manifestPath)
        const state = text ? readInstallState(text) : null
        if (!state) {
          // Steam drops the manifest of a game the logged-in account does not own.
          entry.missingSince ??= this.now()
          if (this.now() - entry.missingSince > (this.deps.missingGraceMs ?? 10_000)) {
            steam.forget(entry.appId)
            this.end(
              entry,
              'failed',
              'Steam a retiré l’installation : ce jeu est-il sur le compte Steam connecté ?'
            )
          }
          continue
        }
        entry.missingSince = null
        if (state.kind === 'installed') {
          steam.forget(entry.appId)
          await this.refreshQuietly()
          this.end(entry, 'installed')
          continue
        }
        const waiting = steam.isWaiting(entry.appId)
        // Steam has it: its content log and its disk writes tell how far the download is.
        const download =
          waiting || state.kind === 'paused' ? null : await live.download(entry.appId)
        if (download) {
          await this.setLiveProgress(entry, download, live)
          continue
        }
        const phase: InstallPhase =
          state.kind === 'queued'
            ? waiting
              ? steam.phase === 'idle'
                ? 'preparing'
                : steam.phase
              : 'queued'
            : state.kind
        const known = state.kind !== 'queued' && state.total > 0
        const ratio = known ? state.downloaded / state.total : null
        this.setProgress(entry, {
          phase,
          // Not below what the live estimate showed before a pause.
          progress:
            ratio === null || state.kind === 'paused' ? ratio : entry.estimator.atLeast(ratio),
          downloadedBytes: known ? state.downloaded : null,
          totalBytes: known ? state.total : null,
          cancellable: waiting
        })
      }
    } finally {
      this.polling = false
      if (![...this.entries.values()].some((e) => e.kind === 'steam')) this.stopTimer()
    }
  }

  private async setLiveProgress(
    entry: Entry & SteamEntry,
    download: SteamLogDownload,
    live: SteamLive
  ): Promise<void> {
    if (download.step === 'preallocating') {
      this.setProgress(entry, { phase: 'allocating', cancellable: false })
      return
    }
    const sample = download.step === 'downloading' ? await live.writes() : null
    const progress = entry.estimator.estimate(download, sample)
    const total = download.total || null
    this.setProgress(entry, {
      phase: download.step === 'finishing' ? 'finishing' : 'downloading',
      progress,
      downloadedBytes: total && progress !== null ? Math.round(progress * total) : null,
      totalBytes: total,
      cancellable: false
    })
  }

  private setProgress(entry: Entry, patch: Partial<InstallProgress>): void {
    const next = { ...entry.progress, ...patch }
    const changed = (Object.keys(patch) as (keyof InstallProgress)[]).some(
      (key) => next[key] !== entry.progress[key]
    )
    if (!changed) return
    entry.progress = next
    this.emitChange()
  }

  private async refreshQuietly(): Promise<void> {
    try {
      await this.deps.refresh()
    } catch (error) {
      console.warn('[install] refresh failed', error)
    }
  }

  private end(entry: Entry, outcome: InstallOutcome, error?: string): void {
    if (this.entries.get(entry.game.id) !== entry) return
    this.entries.delete(entry.game.id)
    this.emitChange()
    this.deps.onEnded(entry.game, outcome, error)
  }

  private emitChange(): void {
    this.deps.onChange(this.list())
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.deps.steamWrites?.stop()
  }
}

/** What one poll reads of Steam's live state, at most once and only when needed. */
class SteamLive {
  private log: Promise<string | null> | null = null
  private sample: ReturnType<ProcessWriteMeter['sample']> | null = null

  constructor(private readonly deps: Pick<InstallServiceDeps, 'steamLog' | 'steamWrites'>) {}

  /** The download of `appId` Steam is running now; null when none (or no log). */
  async download(appId: number): Promise<SteamLogDownload | null> {
    if (!this.deps.steamLog) return null
    this.log ??= this.deps.steamLog().catch(() => null)
    const text = await this.log
    const download = text ? readSteamDownload(text, appId) : null
    return download?.active ? download : null
  }

  writes(): ReturnType<ProcessWriteMeter['sample']> {
    this.sample ??= this.deps.steamWrites?.sample().catch(() => null) ?? Promise.resolve(null)
    return this.sample
  }
}
