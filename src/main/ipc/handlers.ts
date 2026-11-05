import type { AppContext } from '../context'
import { registerAppHandlers } from './app'
import { registerGameHandlers } from './games'
import { registerInsightsHandlers } from './insights'
import { registerLibraryHandlers } from './library'
import { registerOrganizeHandlers } from './organize'
import { registerSettingsHandlers } from './settings'

export function registerIpcHandlers(ctx: AppContext): void {
  registerAppHandlers(ctx)
  registerGameHandlers(ctx)
  registerInsightsHandlers(ctx)
  registerLibraryHandlers(ctx)
  registerOrganizeHandlers(ctx)
  registerSettingsHandlers(ctx)
}
