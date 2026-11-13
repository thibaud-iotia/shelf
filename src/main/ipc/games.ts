import { dirname, isAbsolute } from 'node:path'
import { shell, type OpenDialogOptions } from 'electron'
import { AppError } from '../../shared/errors'
import { isInstallSource } from '../../shared/install'
import type { InstallRequest } from '../../shared/models'
import type { AppContext } from '../context'
import { broadcast } from '../events'
import {
  createManualGame,
  deleteGame,
  getGame,
  getGameDetail,
  getGameRow,
  listGames,
  updateGame
} from '../games/repository'
import { titleFromExecutable } from '../games/titles'
import { validateGameId, validateGameInput, validateGamePatch } from '../games/validation'
import { cancelLaunch, launchGame, runningGameIds } from '../launch/launch-game'
import { exportSaves, backupFileName } from '../saves/backup'
import { mayUninstall, uninstallPlan } from '../sources/uninstall'
import { updateUri } from '../sources/uris'
import { pickPath, pickSavePath } from './dialogs'
import { handle } from './handle'

function validateInstallRequest(value: unknown): InstallRequest {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object')
    throw new AppError('VALIDATION', 'Demande d’installation invalide.')
  const { path, remember } = value as Record<string, unknown>
  if (path !== undefined && (typeof path !== 'string' || !isAbsolute(path))) {
    throw new AppError('VALIDATION', 'Emplacement d’installation : chemin absolu attendu.')
  }
  return { path, remember: remember === true }
}

function executableFilters(): OpenDialogOptions['filters'] {
  if (process.platform === 'win32') {
    return [
      { name: 'Exécutables', extensions: ['exe', 'bat', 'cmd'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ]
  }
  if (process.platform === 'darwin') return [{ name: 'Applications', extensions: ['app'] }]
  return undefined
}

export function registerGameHandlers(ctx: AppContext): void {
  const { db } = ctx.database

  handle('games:list', () => listGames(db))
  handle('games:get', (id) => getGameDetail(db, validateGameId(id)))
  handle('games:create', (input) => createManualGame(db, validateGameInput(input)))
  handle('games:update', (id, patch) =>
    updateGame(db, validateGameId(id), validateGamePatch(patch))
  )
  handle('games:delete', (id) => {
    deleteGame(db, validateGameId(id))
    return null
  })

  handle('games:pickExecutable', async () => {
    const path = await pickPath({
      title: 'Choisir l’exécutable du jeu',
      properties: ['openFile'],
      filters: executableFilters()
    })
    if (!path) return null
    return { path, suggestedTitle: titleFromExecutable(path), installPath: dirname(path) }
  })

  handle('games:launch', async (id) => {
    const result = await launchGame(ctx, validateGameId(id))
    broadcast('library:changed', { reason: 'launch' })
    return result
  })

  handle('games:running', () => runningGameIds(ctx))

  handle('games:launching', () => ctx.launches.list())

  handle('games:cancelLaunch', (id) => {
    cancelLaunch(ctx, validateGameId(id))
    return null
  })

  handle('games:uninstall', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    if (game.installState !== 'installed') {
      throw new AppError('VALIDATION', 'Ce jeu n’est pas installé.')
    }
    const plan = uninstallPlan(game)
    if (!plan) {
      throw new AppError(
        'NOT_FOUND',
        mayUninstall(game)
          ? 'Aucun désinstalleur trouvé dans le dossier du jeu. Désinstallez-le depuis son launcher ou supprimez son dossier.'
          : 'Désinstallez ce jeu depuis son launcher.'
      )
    }
    if (plan.kind === 'uri') {
      await shell.openExternal(plan.uri)
    } else {
      // ShellExecute (not spawn): the uninstallers ask for elevation through UAC.
      const error = await shell.openPath(plan.path)
      if (error) {
        throw new AppError('UNAVAILABLE', `Impossible d’ouvrir le désinstalleur : ${error}`)
      }
    }
    ctx.uninstallWatch.watch(game.id)
    return null
  })

  handle('games:pickSaveFolder', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    const folder = await pickPath({
      title: `Dossier de sauvegardes de ${game.title}`,
      properties: ['openDirectory'],
      defaultPath: game.savePath ?? undefined
    })
    if (!folder) return null
    return updateGame(db, game.id, validateGamePatch({ savePath: folder }))
  })

  handle('games:exportSaves', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    if (!game.savePath) {
      throw new AppError('VALIDATION', 'Choisissez d’abord le dossier de sauvegardes du jeu.')
    }
    const target = await pickSavePath({
      title: 'Exporter les sauvegardes',
      defaultPath: backupFileName(game.title),
      filters: [{ name: 'Archive zip', extensions: ['zip'] }]
    })
    return target ? exportSaves(game.savePath, target) : null
  })

  handle('metadata:search', (title) => ctx.metadata.search(String(title ?? '')))
  handle('metadata:apply', async (id, igdbId) => {
    const gameId = validateGameId(id)
    if (igdbId !== null && (typeof igdbId !== 'number' || !Number.isInteger(igdbId))) {
      throw new AppError('VALIDATION', 'Identifiant IGDB invalide.')
    }
    await ctx.metadata.apply(gameId, igdbId)
    return getGame(db, gameId)
  })
  handle('metadata:refreshArtwork', async (id) => {
    const gameId = validateGameId(id)
    await ctx.metadata.refreshArtwork(gameId)
    return getGame(db, gameId)
  })
  handle('games:pickCover', async (id) => {
    const gameId = validateGameId(id)
    const file = await pickPath({
      title: 'Choisir une jaquette',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (!file) return null
    ctx.metadata.setCustomCover(gameId, file)
    return getGame(db, gameId)
  })

  handle('games:install', async (id, request) => {
    const game = getGameRow(db, validateGameId(id))
    if (game.installState === 'installed') {
      throw new AppError('VALIDATION', 'Ce jeu est déjà installé.')
    }
    const { path, remember } = validateInstallRequest(request)
    const result = await ctx.installs.install(game, { path })
    // "Toujours installer ici": the default location for this launcher, no more asking.
    if (remember && path && result.mode === 'background' && isInstallSource(game.source)) {
      ctx.settings.update({
        installPaths: { ...ctx.settings.get('installPaths'), [game.source]: path },
        askInstallLocation: false
      })
    }
    return result
  })

  handle('games:installLocations', (source) => ctx.installs.locations(String(source)))

  handle('games:pickInstallFolder', async (source) => {
    if (!isInstallSource(source)) {
      throw new AppError('VALIDATION', 'Ce launcher ne permet pas de choisir l’emplacement.')
    }
    const folder = await pickPath({
      title:
        source === 'steam'
          ? 'Dossier d’installation (bibliothèque Steam)'
          : 'Dossier d’installation des jeux Epic',
      properties: ['openDirectory', 'createDirectory']
    })
    return folder ? ctx.installs.pickedFolder(source, folder) : null
  })

  handle('games:installing', () => ctx.installs.list())

  handle('games:cancelInstall', async (id) => {
    await ctx.installs.cancel(validateGameId(id))
    return null
  })

  handle('games:applyUpdate', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    const uri = game.installState === 'installed' ? updateUri(game) : null
    if (!uri) {
      throw new AppError('NOT_FOUND', 'Mettez ce jeu à jour depuis son launcher.')
    }
    await shell.openExternal(uri)
    return null
  })

  handle('games:checkUpdates', async () => {
    await ctx.checkUpdates()
    return listGames(db).filter((g) => g.updateAvailable).length
  })

  handle('games:openFolder', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    const folder = game.installPath ?? (game.executablePath ? dirname(game.executablePath) : null)
    if (!folder) throw new AppError('NOT_FOUND', 'Aucun dossier connu pour ce jeu.')
    const error = await shell.openPath(folder)
    if (error) throw new AppError('NOT_FOUND', `Impossible d’ouvrir le dossier : ${error}`)
    return null
  })
}
