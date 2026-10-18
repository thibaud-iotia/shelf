// All filesystem locations used by the app live here. No hard-coded path anywhere else.

import { join } from 'node:path'
import { app } from 'electron'

/**
 * Lets e2e tests (and power users) isolate data in a throwaway directory.
 * Must run before `app.whenReady()`.
 */
export function applyUserDataOverride(): void {
  const override = process.env.SHELF_USER_DATA
  if (override) app.setPath('userData', override)
}

export const paths = {
  userData: (): string => app.getPath('userData'),
  database: (): string => join(app.getPath('userData'), 'shelf.db'),
  covers: (): string => join(app.getPath('userData'), 'covers'),
  // Packaged: copied via electron-builder extraResources. Dev/e2e: repo root, relative to out/main.
  migrations: (): string =>
    app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle'),
  preload: (): string => join(__dirname, '../preload/index.js'),
  rendererHtml: (): string => join(__dirname, '../renderer/index.html')
}
