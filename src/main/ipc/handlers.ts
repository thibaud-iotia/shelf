import type { AppContext } from '../context'
import { registerAppHandlers } from './app'
import { registerGameHandlers } from './games'

export function registerIpcHandlers(ctx: AppContext): void {
  registerAppHandlers(ctx)
  registerGameHandlers(ctx)
}
