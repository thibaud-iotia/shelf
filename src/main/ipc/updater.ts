import type { AppContext } from '../context'
import { handle } from './handle'

export function registerUpdaterHandlers({ updater }: AppContext): void {
  handle('updater:state', () => updater.getState())
  handle('updater:check', () => updater.check())
  handle('updater:install', () => updater.install())
  handle('updater:openDownload', () => updater.openDownload())
  handle('updater:dismiss', () => updater.dismiss())
}
