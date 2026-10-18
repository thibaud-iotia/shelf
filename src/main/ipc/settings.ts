import type { SettingsView } from '../../shared/models'
import type { AppContext } from '../context'
import { handle } from './handle'

export function settingsView(ctx: AppContext): SettingsView {
  return {
    ...ctx.settings.all(),
    igdbConfigured: false,
    steamGridDbConfigured: false,
    secretsAvailable: false,
    platform: process.platform
  }
}

export function registerSettingsHandlers(ctx: AppContext): void {
  handle('settings:get', () => settingsView(ctx))
  handle('settings:update', (patch) => {
    ctx.settings.update(patch)
    return settingsView(ctx)
  })
}
