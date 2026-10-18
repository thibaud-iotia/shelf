import { execFile } from 'node:child_process'
import { AppError } from '../../shared/errors'
import type { AccountProvider, OwnedGame } from './types'

// Epic (unofficial): Shelf never implements Epic's authentication. It reads the library
// through Legendary (standalone or bundled with Heroic), once the user logged in there.

export type RunCommand = (file: string, args: string[]) => Promise<string>

const run: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
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

async function firstWorking(binaries: string[], args: string[], runCommand: RunCommand) {
  let lastError: unknown = null
  for (const binary of binaries) {
    try {
      return await runCommand(binary, args)
    } catch (error) {
      lastError = error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      break
    }
  }
  if (!lastError || (lastError as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new AppError(
      'UNAVAILABLE',
      'Legendary introuvable : installez Legendary ou Heroic Games Launcher.'
    )
  }
  const stderr = String((lastError as { stderr?: string }).stderr ?? '')
  throw new AppError('UNAVAILABLE', `Legendary a échoué : ${stderr.trim().split('\n').pop() ?? ''}`)
}

export function epicLegendaryProvider(
  binaries: () => string[],
  runCommand: RunCommand = run
): AccountProvider<unknown> {
  return {
    kind: 'epic-legendary',
    source: 'epic',
    async connect() {
      const status = await firstWorking(binaries(), ['status', '--json'], runCommand)
      const account = parseLegendaryStatus(status)
      if (!account) {
        throw new AppError(
          'AUTH',
          'Legendary n’est connecté à aucun compte Epic : lancez « legendary auth » ou connectez Epic dans Heroic.'
        )
      }
      return { displayName: account, externalUserId: account, secret: null }
    },
    async fetchOwned() {
      return {
        games: parseLegendaryList(await firstWorking(binaries(), ['list', '--json'], runCommand))
      }
    }
  }
}
