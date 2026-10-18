import { dirname } from 'node:path'
import { shell, type OpenDialogOptions } from 'electron'
import { AppError } from '../../shared/errors'
import type { AppContext } from '../context'
import { broadcast } from '../events'
import {
  createManualGame,
  deleteGame,
  getGameDetail,
  getGameRow,
  listGames,
  updateGame
} from '../games/repository'
import { titleFromExecutable } from '../games/titles'
import { validateGameId, validateGameInput, validateGamePatch } from '../games/validation'
import { buildLaunchPlan } from '../launch/plan'
import { paths } from '../platform/paths'
import { pickPath } from './dialogs'
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
    const game = getGameRow(db, validateGameId(id))
    const plan = buildLaunchPlan(game, {
      platform: process.platform,
      runnerPath: ctx.settings.get('runnerPath'),
      protonPrefix: paths.protonPrefix()
    })
    const result = await ctx.runner.launch(game.id, plan)
    broadcast('library:changed', { reason: 'launch' })
    return result
  })

  handle('games:running', () => ctx.runner.runningIds())

  handle('games:openFolder', async (id) => {
    const game = getGameRow(db, validateGameId(id))
    const folder = game.installPath ?? (game.executablePath ? dirname(game.executablePath) : null)
    if (!folder) throw new AppError('NOT_FOUND', 'Aucun dossier connu pour ce jeu.')
    const error = await shell.openPath(folder)
    if (error) throw new AppError('NOT_FOUND', `Impossible d’ouvrir le dossier : ${error}`)
    return null
  })
}
