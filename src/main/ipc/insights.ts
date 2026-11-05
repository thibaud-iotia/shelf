import { AppError } from '../../shared/errors'
import { COMMUNITY_KINDS, type CommunityKind } from '../../shared/models'
import type { AppContext } from '../context'
import { validateGameId } from '../games/validation'
import { handle } from './handle'

function validateCommunityKind(value: unknown): CommunityKind {
  if (!(COMMUNITY_KINDS as readonly unknown[]).includes(value)) {
    throw new AppError('VALIDATION', 'Type de contenu communautaire inconnu.')
  }
  return value as CommunityKind
}

export function registerInsightsHandlers(ctx: AppContext): void {
  handle('insights:overview', (id) => ctx.insights.overview(validateGameId(id)))
  handle('insights:news', (id) => ctx.insights.news(validateGameId(id)))
  handle('insights:community', (id, kind) =>
    ctx.insights.community(validateGameId(id), validateCommunityKind(kind))
  )
  handle('insights:achievements', (id) => ctx.insights.achievements(validateGameId(id)))
}
