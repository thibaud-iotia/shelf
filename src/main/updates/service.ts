import { AppError } from '../../shared/errors'
import type { AppUpdateMode, AppUpdateState } from '../../shared/models'
import type { AttemptStore } from './attempt'

/** Where the installers and the `latest*.yml` update files are published (CI, on a tag). */
export const RELEASES_URL = 'https://github.com/thibaud-iotia/shelf/releases'

/** First automatic check, once startup work (sync, artwork) is under way. */
export const FIRST_CHECK_DELAY_MS = 15_000
/** Then every 4 hours: Shelf often stays open for days in the tray. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60_000

/** A newer version announced by the update feed. */
export interface FoundUpdate {
  version: string
  /** File names of the release's installers (from latest*.yml). */
  files: string[]
}

/** The update engine (electron-updater in the packaged app, a simulation in e2e tests). */
export interface UpdaterAdapter {
  /** Newer version on the feed, or null when up to date. */
  check(): Promise<FoundUpdate | null>
  /** Downloads the update found by the last check (checksum verified by the engine). */
  download(onProgress: (percent: number) => void): Promise<void>
  /** Quits Shelf, installs the downloaded update in place and restarts. */
  install(): void
}

export interface UpdateEnvironment {
  packaged: boolean
  platform: NodeJS.Platform
  /** Set by the AppImage runtime: the file electron-updater replaces. */
  appImage?: string
}

/**
 * How Shelf can update itself here. Windows (NSIS) and AppImage install in place.
 * macOS is unsigned: Squirrel.Mac refuses to swap an unsigned app, so the user replaces it in
 * Applications. A .deb would need root (pkexec): the new package is opened instead.
 */
export function updateMode({ packaged, platform, appImage }: UpdateEnvironment): AppUpdateMode {
  if (!packaged) return 'disabled'
  if (platform === 'win32') return 'auto'
  if (platform === 'linux') return appImage ? 'auto' : 'manual'
  if (platform === 'darwin') return 'manual'
  return 'disabled'
}

/** Installer of this install: .exe (Windows), .dmg (macOS), .AppImage or .deb (Linux). */
function installerExtension(platform: NodeJS.Platform, mode: AppUpdateMode): string | null {
  if (platform === 'win32') return '.exe'
  if (platform === 'darwin') return '.dmg'
  if (platform === 'linux') return mode === 'auto' ? '.appimage' : '.deb'
  return null
}

/**
 * The installer to download by hand (`manual` mode, or an install that was blocked); the
 * release page when the release has none for this platform.
 */
export function manualDownloadUrl(
  update: FoundUpdate,
  platform: NodeJS.Platform,
  mode: AppUpdateMode
): string {
  const extension = installerExtension(platform, mode)
  const file = extension && update.files.find((f) => f.toLowerCase().endsWith(extension))
  const tag = `v${update.version}`
  return file
    ? `${RELEASES_URL}/download/${tag}/${encodeURIComponent(file)}`
    : `${RELEASES_URL}/tag/${tag}`
}

/** Compares "1.10.0" and "1.9.2" numerically (pre-release suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split('-')[0]!
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // electron-updater errors can carry a whole HTTP response: keep the first line.
  return text.split('\n')[0]!.trim().slice(0, 200)
}

export interface UpdateServiceOptions {
  adapter: UpdaterAdapter | null
  mode: AppUpdateMode
  currentVersion: string
  platform: NodeJS.Platform
  /** Automatic checks (setting); a check asked by the user always runs. */
  enabled: () => boolean
  onChange: (state: AppUpdateState) => void
  openExternal: (url: string) => Promise<void>
  /** Remembers the update Shelf restarted on, to tell at the next startup if it installed. */
  attempts?: AttemptStore
  now?: () => number
}

/**
 * Shelf's own updates: checks the feed (at startup, every 4 h, or on demand), downloads in
 * the background in `auto` mode, then waits for the user's restart. A downloaded update is
 * also installed when Shelf quits (electron-updater's `autoInstallOnAppQuit`).
 */
export class UpdateService {
  private state: AppUpdateState
  private found: FoundUpdate | null = null
  /** The update whose install did not happen (still on the old version after the restart). */
  private blocked: FoundUpdate | null = null
  private checking: Promise<AppUpdateState> | null = null
  private timers: NodeJS.Timeout[] = []
  private readonly now: () => number

  constructor(private readonly options: UpdateServiceOptions) {
    this.now = options.now ?? Date.now
    this.state = {
      mode: options.mode,
      phase: 'idle',
      currentVersion: options.currentVersion,
      version: null,
      percent: null,
      releaseUrl: null,
      checkedAt: null,
      error: null,
      lastInstall: null
    }
    this.readLastAttempt()
  }

  /**
   * Restarted on an update: installed if Shelf now runs that version (or newer). Otherwise the
   * installer never ran or failed (antivirus, closed UAC prompt…); the old version is intact.
   */
  private readLastAttempt(): void {
    const { attempts, currentVersion } = this.options
    const attempt = attempts?.read()
    if (!attempt) return
    attempts!.write(null)
    const installed = compareVersions(currentVersion, attempt.version) >= 0
    this.state.lastInstall = {
      version: attempt.version,
      outcome: installed ? 'installed' : 'failed'
    }
    if (!installed) {
      this.blocked = { version: attempt.version, files: attempt.files }
      this.state.releaseUrl = `${RELEASES_URL}/tag/v${attempt.version}`
    }
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  /** Schedules the automatic checks (skipped while the setting is off). */
  start(firstDelayMs = FIRST_CHECK_DELAY_MS, intervalMs = CHECK_INTERVAL_MS): void {
    if (!this.options.adapter || this.options.mode === 'disabled') return
    const tick = () => {
      if (this.options.enabled()) void this.check()
    }
    const first = setTimeout(tick, firstDelayMs)
    const every = setInterval(tick, intervalMs)
    first.unref?.()
    every.unref?.()
    this.timers.push(first, every)
  }

  /** One check at a time; nothing to look for once an update is downloading or ready. */
  check(): Promise<AppUpdateState> {
    const { adapter, mode } = this.options
    if (!adapter || mode === 'disabled') {
      return Promise.reject(
        new AppError('UNAVAILABLE', 'Mises à jour indisponibles dans une version de développement.')
      )
    }
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') {
      return Promise.resolve(this.getState())
    }
    this.checking ??= this.runCheck(adapter).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async runCheck(adapter: UpdaterAdapter): Promise<AppUpdateState> {
    this.set({ phase: 'checking', error: null })
    let found: FoundUpdate | null
    try {
      found = await adapter.check()
    } catch (error) {
      this.set({
        phase: 'error',
        checkedAt: this.now(),
        error: `Impossible de vérifier les mises à jour : ${reason(error)}`
      })
      return this.getState()
    }
    this.found = found
    if (!found) {
      this.set({ phase: 'up-to-date', version: null, releaseUrl: null, checkedAt: this.now() })
      return this.getState()
    }
    const releaseUrl = `${RELEASES_URL}/tag/v${found.version}`
    if (this.options.mode === 'manual') {
      this.set({ phase: 'available', version: found.version, releaseUrl, checkedAt: this.now() })
      return this.getState()
    }
    this.set({
      phase: 'downloading',
      version: found.version,
      releaseUrl,
      percent: 0,
      checkedAt: this.now()
    })
    const started = this.getState()
    void this.download(adapter)
    return started
  }

  private async download(adapter: UpdaterAdapter): Promise<void> {
    try {
      await adapter.download((percent) => {
        const rounded = Math.max(0, Math.min(100, Math.round(percent)))
        if (rounded !== this.state.percent) this.set({ percent: rounded })
      })
      this.set({ phase: 'ready', percent: 100 })
    } catch (error) {
      this.set({
        phase: 'error',
        percent: null,
        error: `Échec du téléchargement de la mise à jour : ${reason(error)}`
      })
    }
  }

  /** Restarts on the downloaded version. */
  install(): void {
    const { adapter, attempts, mode } = this.options
    if (mode !== 'auto' || this.state.phase !== 'ready' || !adapter || !this.found) {
      throw new AppError('VALIDATION', 'Aucune mise à jour prête à installer.')
    }
    attempts?.write({ version: this.found.version, files: this.found.files, at: this.now() })
    adapter.install()
  }

  /** The new installer, downloaded by the browser: `manual` mode, or a blocked install. */
  async openDownload(): Promise<void> {
    const update = this.state.phase === 'available' ? this.found : this.blocked
    if (!update) throw new AppError('VALIDATION', 'Aucune nouvelle version à télécharger.')
    const { platform, mode } = this.options
    await this.options.openExternal(manualDownloadUrl(update, platform, mode))
  }

  /** Hides the notice about the last install. */
  dismiss(): AppUpdateState {
    if (this.state.lastInstall) this.set({ lastInstall: null })
    return this.getState()
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  private set(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.options.onChange(this.getState())
  }
}
