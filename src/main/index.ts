import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import { createProviders } from './accounts'
import { AccountService } from './accounts/service'
import type { AppContext } from './context'
import { openDatabase } from './db/client'
import { broadcast } from './events'
import { closeSession, discardUnfinishedSessions, openSession } from './games/repository'
import { registerIpcHandlers } from './ipc/handlers'
import { ImportService } from './import/service'
import { GameRunner } from './launch/runner'
import { applyUserDataOverride, launcherLocations, paths } from './platform/paths'
import { SecretStore } from './secrets/store'
import { SettingsStore } from './settings/store'
import { createSources } from './sources'
import { createMainWindow } from './window'

app.setName('Shelf')
applyUserDataOverride()
app.enableSandbox()

let ctx: AppContext | undefined

function createContext(): AppContext {
  const database = openDatabase(paths.database(), paths.migrations())
  const { db } = database
  discardUnfinishedSessions(db)

  const runner = new GameRunner({
    openExternal: (uri) => shell.openExternal(uri),
    onStart: (gameId, startedAt) => openSession(db, gameId, startedAt),
    onExit: (_gameId, sessionId, endedAt) => {
      closeSession(db, sessionId, endedAt)
      broadcast('library:changed', { reason: 'session' })
    }
  })
  runner.on('change', (ids) => broadcast('games:running', ids))

  const settings = new SettingsStore(db)
  const importer = new ImportService(db, settings, createSources(launcherLocations))
  const secrets = new SecretStore(paths.secrets(), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  const accounts = new AccountService(db, secrets, createProviders(launcherLocations), {
    // GOG option B stays behind its flag.
    isEnabled: (kind) => kind !== 'gog-oauth' || settings.get('gogOAuthEnabled')
  })
  return { database, settings, runner, importer, secrets, accounts }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  })

  app
    .whenReady()
    .then(() => {
      ctx = createContext()
      registerIpcHandlers(ctx)
      createMainWindow()
      // Keep install states fresh: launcher games installed/removed while Shelf was closed.
      void ctx.importer
        .refreshInstalled()
        .then((report) => report && broadcast('library:changed', { reason: 'refresh' }))
        .catch((error: unknown) => console.warn('[startup] refresh failed', error))
      // Owned libraries: automatic sync when the last one is older than 24 h.
      void ctx.accounts
        .syncDue()
        .then((reports) => reports.length && broadcast('library:changed', { reason: 'sync' }))
        .catch((error: unknown) => console.warn('[startup] sync failed', error))

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      })
    })
    .catch((error: unknown) => {
      console.error('[startup] fatal', error)
      dialog.showErrorBox(
        'Shelf ne peut pas démarrer',
        error instanceof Error ? error.message : String(error)
      )
      app.exit(1)
    })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  ctx?.runner.dispose()
  ctx?.database.close()
})
