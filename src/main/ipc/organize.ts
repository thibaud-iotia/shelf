import { AppError } from '../../shared/errors'
import type { AppContext } from '../context'
import {
  addToCollection,
  createCollection,
  deleteCollection,
  deleteTag,
  listCollections,
  listTags,
  removeFromCollection,
  setGameTags,
  updateCollection
} from '../games/organize'
import { getGame } from '../games/repository'
import { validateGameId } from '../games/validation'
import { handle } from './handle'

function validateId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppError('VALIDATION', `${label} invalide.`)
  }
  return value
}

export function registerOrganizeHandlers(ctx: AppContext): void {
  const { db } = ctx.database

  handle('tags:list', () => listTags(db))
  handle('tags:delete', (id) => {
    deleteTag(db, validateId(id, 'Tag'))
    return null
  })
  handle('games:setTags', (gameId, names) => {
    const id = validateGameId(gameId)
    setGameTags(db, id, names)
    return getGame(db, id)
  })

  handle('collections:list', () => listCollections(db))
  handle('collections:create', (name, rules) => createCollection(db, name, rules))
  handle('collections:update', (id, patch) =>
    updateCollection(db, validateId(id, 'Collection'), patch ?? {})
  )
  handle('collections:delete', (id) => {
    deleteCollection(db, validateId(id, 'Collection'))
    return null
  })
  handle('collections:addGames', (id, gameIds) => {
    if (!Array.isArray(gameIds)) throw new AppError('VALIDATION', 'Jeux invalides.')
    return addToCollection(
      db,
      validateId(id, 'Collection'),
      gameIds.map((g) => validateGameId(g))
    )
  })
  handle('collections:removeGame', (id, gameId) =>
    removeFromCollection(db, validateId(id, 'Collection'), validateGameId(gameId))
  )
}
