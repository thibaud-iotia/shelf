// Rockstar Games Launcher: install, uninstall and update go through `Launcher.exe` — it has no
// URI scheme and no silent mode. `-enableFullMode -install=<titleId>` opens the launcher on the
// game's install (the user picks the folder there), `-uninstall=<titleId>` on its removal.
// Shelf then follows the install through the uninstall entry the launcher writes and its log.

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '../../shared/errors'
import { ROCKSTAR_TITLE_ID, rockstarTitle } from '../../shared/rockstar'
import type { RegistryKey } from '../platform/registry'
import { rockstarInstalls } from '../sources/rockstar'
import {
  normalizeName,
  readRockstarLogs,
  readTitleTable,
  readUpdateOutcomes,
  sameFolder,
  type RockstarUpdateOutcome
} from '../sources/rockstar-log'

export type RockstarAction = 'install' | 'uninstall' | 'open'

/** Arguments of `Launcher.exe` for an action on a game. */
export function rockstarArgs(action: RockstarAction, titleId?: string): string[] {
  if (action === 'open') return []
  if (!titleId || !ROCKSTAR_TITLE_ID.test(titleId)) {
    throw new AppError('VALIDATION', 'Identifiant de jeu Rockstar invalide.')
  }
  return ['-enableFullMode', `-${action}=${titleId}`]
}

export interface RockstarInstallState {
  /** The launcher finished installing the game. */
  installed: boolean
  /** Last "Update/Install of <game> …" line of the log since the install started. */
  outcome: RockstarUpdateOutcome | null
  downloadedBytes: number | null
  totalBytes: number | null
}

export interface RockstarLauncherDeps {
  launcher: () => Promise<string | null>
  uninstallKeys: () => Promise<RegistryKey[]>
  logDir: () => string
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  exists?: (path: string) => boolean
}

export class RockstarLauncher {
  constructor(private readonly deps: RockstarLauncherDeps) {}

  /** Starts `Launcher.exe` with the arguments of `action` (detached: it outlives Shelf). */
  async run(action: RockstarAction, titleId?: string): Promise<void> {
    const args = rockstarArgs(action, titleId)
    const launcher = await this.deps.launcher()
    if (!launcher) {
      throw new AppError(
        'NOT_FOUND',
        'Rockstar Games Launcher introuvable : installez-le (Windows) depuis rockstargames.com.'
      )
    }
    const child = (this.deps.spawn ?? spawn)(launcher, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', (error) =>
        reject(
          new AppError(
            'UNAVAILABLE',
            `Impossible de démarrer le Rockstar Games Launcher : ${error.message}`
          )
        )
      )
    })
    child.unref()
  }

  async available(): Promise<boolean> {
    return (await this.deps.launcher()) !== null
  }

  /** Where the install of `titleId` (started at `since`) stands. */
  async state(titleId: string, title: string, since: number): Promise<RockstarInstallState> {
    const exists = this.deps.exists ?? existsSync
    const install = rockstarInstalls(await this.deps.uninstallKeys()).find(
      (i) => i.titleId === titleId
    )
    const executable = rockstarTitle(titleId)?.executable
    const onDisk = !!install && (!executable || exists(join(install.installPath, executable)))

    const entries = await readRockstarLogs(this.deps.logDir(), 1)
    const outcomes = readUpdateOutcomes(entries, since)
    const names = [title, install?.title, rockstarTitle(titleId)?.title]
      .filter((n): n is string => !!n)
      .map(normalizeName)
    // The launcher's names change ("… Legacy"): any of the known names, exactly (a prefix would
    // mix "Grand Theft Auto V" up with "Grand Theft Auto V Enhanced").
    const outcome = [...outcomes].find(([name]) => names.includes(name))?.[1].outcome ?? null

    const table = readTitleTable(entries)
    const row =
      table && table.time >= since && install
        ? table.rows.find((r) => sameFolder(r.location, install.installPath))
        : undefined
    return {
      // The launcher registers the game and writes its files before the download ends: the
      // log's "… succeeded" line is the reliable end. Without a readable log, the disk.
      installed: outcome === 'succeeded' || (entries.length === 0 && onDisk && !row?.pending),
      outcome,
      downloadedBytes: row?.downloadedBytes ?? null,
      totalBytes: row?.totalBytes ?? null
    }
  }
}
