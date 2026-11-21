import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { dirname, join } from 'node:path'
import { AppError } from '../../shared/errors'
import { readJson, readText } from '../sources/fs'

// Background Epic installs through Legendary (standalone or Heroic's copy), once the user is
// logged in there: `legendary install <app> --yes` downloads without any prompt. The game is
// then managed by Legendary/Heroic (not the Epic Games Launcher): Shelf launches it through
// Legendary too (see `legendaryLaunchFor`).

/**
 * A Legendary executable. Heroic runs its bundled copy with its own config folder
 * (`LEGENDARY_CONFIG_PATH`): without it, Legendary reads `~/.config/legendary` and sees no
 * account even though the user is logged in to Epic in Heroic.
 */
export interface LegendaryBinary {
  file: string
  configPath?: string
  /** The `installed.json` this binary writes (games it installed, launched through it). */
  installedFile?: string
  /** Heroic's `config.json`: its default install folder is used for installs from Shelf. */
  heroicConfig?: string
  /** Where this binary installs when nothing else is set (Legendary: `~/Games`). */
  defaultInstallDir?: string
}

export type RunCommand = (binary: LegendaryBinary, args: string[]) => Promise<string>

export const runLegendary: RunCommand = ({ file, configPath }, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
        env: configPath ? { ...process.env, LEGENDARY_CONFIG_PATH: configPath } : process.env
      },
      (error, stdout, stderr) =>
        error ? reject(Object.assign(error, { stderr })) : resolve(stdout)
    )
  })

export function parseLegendaryStatus(stdout: string): string | null {
  try {
    const account = (JSON.parse(stdout) as { account?: string }).account
    return account && !account.startsWith('<') ? account : null
  } catch {
    return null
  }
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export function legendaryError(error: unknown): AppError {
  if (!error || isMissing(error)) {
    return new AppError(
      'UNAVAILABLE',
      'Legendary introuvable : installez Legendary ou Heroic Games Launcher.'
    )
  }
  const stderr = String((error as { stderr?: string }).stderr ?? '')
  return new AppError(
    'UNAVAILABLE',
    `Legendary a échoué : ${stderr.trim().split('\n').pop() ?? ''}`
  )
}

/**
 * First binary logged in to an Epic account. A standalone `legendary` on PATH may run without
 * an account while Heroic's copy has one: every candidate is tried before giving up.
 */
export async function loggedIn(
  binaries: LegendaryBinary[],
  runCommand: RunCommand
): Promise<{ binary: LegendaryBinary; account: string }> {
  let failure: unknown = null
  let anonymous = false
  for (const binary of binaries) {
    try {
      const account = parseLegendaryStatus(await runCommand(binary, ['status', '--json']))
      if (account) return { binary, account }
      anonymous = true
    } catch (error) {
      if (!failure || isMissing(failure)) failure = error
    }
  }
  if (anonymous) {
    throw new AppError(
      'AUTH',
      'Legendary n’est connecté à aucun compte Epic : lancez « legendary auth » ou connectez Epic dans Heroic.'
    )
  }
  throw legendaryError(failure)
}

export interface LegendaryProgress {
  /** 0…1 */
  progress: number | null
  downloadedBytes: number | null
  totalBytes: number | null
}

const UNITS: Record<string, number> = { kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

function bytes(value: string, unit: string): number | null {
  const n = Number.parseFloat(value)
  const factor = UNITS[unit.toLowerCase()]
  return Number.isFinite(n) && factor ? Math.round(n * factor) : null
}

/**
 * Folds a line of Legendary's log into the progress so far:
 *   [cli] INFO: Download size: 1584.47 MiB (Compression savings: 57.3%)
 *   [DLManager] INFO: = Progress: 12.34% (120/970), Running for 00:00:10, ETA: 00:01:20
 *   [DLManager] INFO:  - Downloaded: 195.42 MiB, Written: 446.82 MiB
 * Returns null when the line tells nothing new.
 */
export function parseLegendaryLine(
  line: string,
  current: LegendaryProgress
): LegendaryProgress | null {
  const size = /Download size: ([\d.]+) ([KMGT]iB)/i.exec(line)
  if (size) return { ...current, totalBytes: bytes(size[1]!, size[2]!) }
  const progress = /= Progress: ([\d.]+)%/.exec(line)
  if (progress) {
    const value = Number.parseFloat(progress[1]!) / 100
    return Number.isFinite(value) ? { ...current, progress: Math.min(1, Math.max(0, value)) } : null
  }
  const downloaded = /- Downloaded: ([\d.]+) ([KMGT]iB)/i.exec(line)
  if (downloaded) return { ...current, downloadedBytes: bytes(downloaded[1]!, downloaded[2]!) }
  return null
}

/** The message of a failed install: Legendary's last error line. */
export function legendaryFailure(output: string): string {
  const lines = output
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
  const error = [...lines].reverse().find((line) => /\b(ERROR|CRITICAL)\b/.test(line))
  const message = (error ?? lines.at(-1) ?? '').replace(/^\[[^\]]*\]\s*(ERROR|CRITICAL):\s*/, '')
  return message ? `Legendary a échoué : ${message}` : 'Legendary a échoué.'
}

export function legendaryInstallArgs(appName: string, basePath: string | null): string[] {
  return [
    'install',
    appName,
    '--yes',
    // No prompt for optional content (selective downloads), owned DLCs installed with the game.
    '--skip-sdl',
    '--with-dlcs',
    ...(basePath ? ['--base-path', basePath] : [])
  ]
}

/** Heroic's default install folder (`config.json` › defaultSettings.defaultInstallPath). */
export function heroicInstallPath(config: unknown): string | null {
  const settings = (config as { defaultSettings?: { defaultInstallPath?: unknown } } | null)
    ?.defaultSettings
  const path = settings?.defaultInstallPath
  return typeof path === 'string' && path.trim() ? path.trim() : null
}

/** `install_dir` of Legendary's `config.ini` ([Legendary] section). */
export function legendaryInstallDir(ini: string): string | null {
  let section = ''
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) section = header[1]!.trim().toLowerCase()
    else if (section === 'legendary') {
      const entry = /^install_dir\s*[=:]\s*(.+)$/i.exec(line)
      if (entry?.[1]?.trim()) return entry[1].trim()
    }
  }
  return null
}

export type InstallOutcome = 'installed' | 'cancelled'

export interface LegendaryInstall {
  /** Resolves when Legendary is done; rejects with an AppError when it failed. */
  done: Promise<InstallOutcome>
  cancel: () => void
}

export interface LegendaryInstallerDeps {
  binaries: () => LegendaryBinary[]
  runCommand?: RunCommand
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  /** Stops Legendary and its download workers. */
  kill?: (child: ChildProcess) => void
}

const AVAILABLE_TTL_MS = 5 * 60_000

function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    // Legendary's download workers are separate processes: the whole tree goes.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    }).on('error', () => child.kill())
  } else {
    // Legendary stops its workers on Ctrl+C (KeyboardInterrupt).
    child.kill('SIGINT')
  }
}

export class LegendaryInstaller {
  private readonly children = new Set<ChildProcess>()
  /** Last logged-in binary found: Legendary takes seconds to answer, asked once in a while. */
  private found: { binary: LegendaryBinary; at: number } | null = null

  constructor(private readonly deps: LegendaryInstallerDeps) {}

  /** Whether a logged-in Legendary is available (installs then run in the background). */
  async available(): Promise<LegendaryBinary | null> {
    const now = Date.now()
    if (this.found && now - this.found.at < AVAILABLE_TTL_MS) return this.found.binary
    try {
      const { binary } = await loggedIn(this.deps.binaries(), this.deps.runCommand ?? runLegendary)
      this.found = { binary, at: now }
      return binary
    } catch {
      this.found = null
      return null
    }
  }

  start(
    binary: LegendaryBinary,
    appName: string,
    basePath: string | null,
    onProgress: (progress: LegendaryProgress) => void
  ): LegendaryInstall {
    const spawnFn = this.deps.spawn ?? spawn
    const child = spawnFn(binary.file, legendaryInstallArgs(appName, basePath), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: binary.configPath
        ? { ...process.env, LEGENDARY_CONFIG_PATH: binary.configPath }
        : process.env
    })
    this.children.add(child)
    let cancelled = false
    let output = ''
    let progress: LegendaryProgress = { progress: null, downloadedBytes: null, totalBytes: null }
    let partial = ''
    const onData = (chunk: Buffer | string) => {
      const text = partial + chunk.toString()
      const lines = text.split(/\r?\n|\r/)
      partial = lines.pop() ?? ''
      for (const line of lines) {
        const next = parseLegendaryLine(line, progress)
        if (next) {
          progress = next
          onProgress(progress)
        }
      }
      // Only the tail matters for the error message.
      output = (output + text).slice(-8_000)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    const done = new Promise<InstallOutcome>((resolve, reject) => {
      child.once('error', (error) => {
        this.children.delete(child)
        reject(legendaryError(error))
      })
      child.once('close', (code) => {
        this.children.delete(child)
        if (cancelled) resolve('cancelled')
        else if (code === 0) resolve('installed')
        else reject(new AppError('UNAVAILABLE', legendaryFailure(output + partial)))
      })
    })
    return {
      done,
      cancel: () => {
        if (cancelled) return
        cancelled = true
        ;(this.deps.kill ?? killTree)(child)
      }
    }
  }

  /**
   * Default install folder: Heroic's for Heroic's copy, Legendary's `install_dir` setting
   * (config.ini) otherwise, else the binary's built-in default.
   */
  async basePath(binary: LegendaryBinary): Promise<string | null> {
    if (binary.heroicConfig) {
      const heroic = heroicInstallPath(await readJson(binary.heroicConfig))
      if (heroic) return heroic
    }
    const configDir =
      binary.configPath ?? (binary.installedFile ? dirname(binary.installedFile) : null)
    const ini = configDir ? await readText(join(configDir, 'config.ini')) : null
    return (ini ? legendaryInstallDir(ini) : null) ?? binary.defaultInstallDir ?? null
  }

  /** Shelf is quitting: Legendary resumes the download at the next install. */
  dispose(): void {
    for (const child of this.children) (this.deps.kill ?? killTree)(child)
    this.children.clear()
  }
}

/** Legendary installs of an app: the binary whose `installed.json` lists it. */
export async function legendaryOwnerOf(
  appName: string,
  binaries: LegendaryBinary[]
): Promise<LegendaryBinary | null> {
  for (const binary of binaries) {
    if (!binary.installedFile) continue
    const installed = await readJson<Record<string, unknown>>(binary.installedFile)
    if (installed && Object.hasOwn(installed, appName)) return binary
  }
  return null
}
