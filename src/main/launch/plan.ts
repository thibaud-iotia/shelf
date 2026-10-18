import { basename, dirname, extname } from 'node:path'
import { AppError } from '../../shared/errors'
import type { GameRow } from '../games/repository'
import { launchUri } from '../sources/uris'
import { parseArgs } from './args'

export type LaunchPlan =
  | { kind: 'process'; command: string; args: string[]; cwd: string; env?: Record<string, string> }
  | { kind: 'uri'; uri: string }

export interface LaunchOptions {
  platform: NodeJS.Platform
  /** Wine or Proton executable (Linux). */
  runnerPath: string | null
  /** Prefix directory handed to Proton (STEAM_COMPAT_DATA_PATH). */
  protonPrefix: string
}

type LaunchTarget = Pick<
  GameRow,
  'source' | 'sourceId' | 'executablePath' | 'launchArgs' | 'useRunner'
>

/** Decides how a game starts: through its launcher's URI, or as a process Shelf tracks. */
export function buildLaunchPlan(game: LaunchTarget, options: LaunchOptions): LaunchPlan {
  // Steam and Epic games need their launcher (DRM, overlay, cloud saves).
  if (game.source === 'steam' || game.source === 'epic') {
    return { kind: 'uri', uri: launchUri(game, options.platform)! }
  }

  if (game.executablePath) {
    const exe = game.executablePath
    const args = parseArgs(game.launchArgs)
    const cwd = dirname(exe)

    const isWindowsExe = extname(exe).toLowerCase() === '.exe'
    const viaRunner =
      options.platform === 'linux' && (game.useRunner || (isWindowsExe && !!options.runnerPath))
    if (viaRunner) {
      if (!options.runnerPath) {
        throw new AppError(
          'VALIDATION',
          'Indiquez le chemin de Wine ou Proton dans Réglages › Système pour lancer ce jeu.'
        )
      }
      if (basename(options.runnerPath).toLowerCase().startsWith('proton')) {
        return {
          kind: 'process',
          command: options.runnerPath,
          args: ['run', exe, ...args],
          cwd,
          env: {
            STEAM_COMPAT_DATA_PATH: options.protonPrefix,
            STEAM_COMPAT_CLIENT_INSTALL_PATH: options.protonPrefix
          }
        }
      }
      return { kind: 'process', command: options.runnerPath, args: [exe, ...args], cwd }
    }

    // macOS bundles: `open -W` blocks until the app quits, so the session is measured.
    if (options.platform === 'darwin' && extname(exe) === '.app') {
      return {
        kind: 'process',
        command: 'open',
        args: ['-W', exe, ...(args.length ? ['--args', ...args] : [])],
        cwd
      }
    }
    return { kind: 'process', command: exe, args, cwd }
  }

  const uri = launchUri(game, options.platform)
  if (uri) return { kind: 'uri', uri }
  throw new AppError('VALIDATION', 'Aucun exécutable n’est défini pour ce jeu.')
}
