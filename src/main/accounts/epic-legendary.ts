import { execFile } from 'node:child_process'
import { AppError } from '../../shared/errors'
import type { AccountProvider, OwnedGame } from './types'

// Epic (unofficial): Shelf never implements Epic's authentication. It reads the library
// through Legendary (standalone or bundled with Heroic), once the user logged in there.

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

interface LegendaryGame {
  app_name?: string
  app_title?: string
  is_dlc?: boolean
}

export function parseLegendaryList(stdout: string): OwnedGame[] {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    throw new AppError('NETWORK', 'Réponse illisible de Legendary.')
  }
  if (!Array.isArray(data)) throw new AppError('NETWORK', 'Réponse inattendue de Legendary.')
  return (data as LegendaryGame[]).flatMap((g) =>
    g.app_name && g.app_title && !g.is_dlc
      ? [{ source: 'epic' as const, sourceId: g.app_name, title: g.app_title }]
      : []
  )
}

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

export function epicLegendaryProvider(
  binaries: () => LegendaryBinary[],
  runCommand: RunCommand = runLegendary
): AccountProvider<unknown> {
  return {
    kind: 'epic-legendary',
    source: 'epic',
    async connect() {
      const { account } = await loggedIn(binaries(), runCommand)
      return { displayName: account, externalUserId: account, secret: null }
    },
    async fetchOwned() {
      const { binary } = await loggedIn(binaries(), runCommand)
      let stdout: string
      try {
        stdout = await runCommand(binary, ['list', '--json'])
      } catch (error) {
        throw legendaryError(error)
      }
      return { games: parseLegendaryList(stdout) }
    }
  }
}
