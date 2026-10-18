import { AppError } from '../../shared/errors'
import type { ApiKeyService, SettingsView } from '../../shared/models'
import type { AppContext } from '../context'
import { broadcast } from '../events'
import { handle } from './handle'

export function settingsView(ctx: AppContext): SettingsView {
  return {
    ...ctx.settings.all(),
    igdbConfigured: ctx.metadata.igdbConfigured(),
    steamGridDbConfigured: ctx.metadata.steamGridDbConfigured(),
    secretsAvailable: ctx.secrets.available(),
    platform: process.platform
  }
}

export function registerSettingsHandlers(ctx: AppContext): void {
  handle('settings:get', () => settingsView(ctx))
  handle('settings:update', (patch) => {
    ctx.settings.update(patch)
    return settingsView(ctx)
  })

  handle('keys:set', (input) => {
    if (!input || typeof input !== 'object') throw new AppError('VALIDATION', 'Clés invalides.')
    ctx.metadata.setKeys(input)
    return settingsView(ctx)
  })
  handle('keys:clear', (service) => {
    ctx.metadata.clearKeys(apiService(service))
    return settingsView(ctx)
  })
  handle('keys:test', (service) => ctx.metadata.test(apiService(service)))

  handle('cache:info', () => ctx.metadata.cacheInfo())
  handle('cache:clear', () => {
    ctx.metadata.clearCache()
    broadcast('library:changed', { reason: 'cache' })
    return ctx.metadata.cacheInfo()
  })
}

function apiService(value: unknown): ApiKeyService {
  if (value !== 'igdb' && value !== 'steamgriddb') {
    throw new AppError('VALIDATION', 'Service inconnu.')
  }
  return value
}
