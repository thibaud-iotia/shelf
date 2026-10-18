import { app } from 'electron'
import type { DatabaseHandle } from '../db/client'
import { paths } from '../platform/paths'
import { handle } from './handle'

export function registerIpcHandlers(database: DatabaseHandle): void {
  handle('app:ping', () => ({ message: 'pong', receivedAt: new Date().toISOString() }))

  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    userDataPath: paths.userData(),
    databasePath: paths.database(),
    appliedMigrations: database.appliedMigrations
  }))
}
