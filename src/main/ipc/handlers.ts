import type { AppContext } from '../context'
import { registerAppHandlers } from './app'
import { registerGameHandlers } from './games'
import { registerLibraryHandlers } from './library'
import { registerOrganizeHandlers } from './organize'
import { registerSettingsHandlers } from './settings'

export function registerIpcHandlers(ctx: AppContext): void {
  registerAppHandlers(ctx)
  registerGameHandlers(ctx)
  registerLibraryHandlers(ctx)
  registerOrganizeHandlers(ctx)
  registerSettingsHandlers(ctx)
}
