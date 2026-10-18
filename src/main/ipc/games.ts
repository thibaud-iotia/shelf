import { dirname } from 'node:path'
import { shell, type OpenDialogOptions } from 'electron'
import { AppError } from '../../shared/errors'
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
import { launchGame, runningGameIds } from '../launch/launch-game'
import { exportSaves, backupFileName } from '../saves/backup'
import { installUri, uninstallUri } from '../sources/uris'
import { pickPath, pickSavePath } from './dialogs'
import { handle } from './handle'

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

  handle('games:uninstall', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    const uri = uninstallUri(game)
    if (!uri) {
      throw new AppError('NOT_FOUND', 'Désinstallez ce jeu depuis son launcher ou son dossier.')
    }
    await shell.openExternal(uri)
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

  handle('games:install', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    const uri = installUri(game)
    if (!uri) throw new AppError('NOT_FOUND', 'Ce jeu ne peut pas être installé depuis Shelf.')
    await shell.openExternal(uri)
    return null
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
