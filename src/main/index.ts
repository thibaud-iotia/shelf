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
import { MediaCache } from './media/cache'
import { handleMediaProtocol, registerMediaScheme } from './media/protocol'
import { MetadataService, type EnrichTarget } from './metadata/service'
import { applyUserDataOverride, launcherLocations, paths } from './platform/paths'
import { SecretStore } from './secrets/store'
import { SettingsStore } from './settings/store'
import { createSources } from './sources'
import { createMainWindow } from './window'

app.setName('Shelf')
applyUserDataOverride()
app.enableSandbox()
registerMediaScheme()

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
  const secrets = new SecretStore(paths.secrets(), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  const metadata = new MetadataService(db, secrets, new MediaCache(paths.covers()))

  // Metadata enrichment runs in the background, one batch at a time.
  let queue = Promise.resolve()
  const enqueue = (job: () => Promise<number>) => {
    queue = queue
      .then(job)
      .then((count) => {
        if (count) broadcast('library:changed', { reason: 'metadata' })
      })
      .catch((error: unknown) => console.warn('[metadata] background job failed', error))
  }
  const progress = () => broadcast('library:changed', { reason: 'metadata' })
  const enrich = (targets: EnrichTarget[]) => enqueue(() => metadata.enrich(targets, progress))

  const importer = new ImportService(db, settings, createSources(launcherLocations), enrich)
  const accounts = new AccountService(db, secrets, createProviders(launcherLocations), {
    // GOG option B stays behind its flag.
    isEnabled: (kind) => kind !== 'gog-oauth' || settings.get('gogOAuthEnabled')
  })
  const onSynced = () => enqueue(() => metadata.enrichMissing(100, progress))
  return { database, settings, runner, importer, secrets, accounts, metadata, onSynced }
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
      handleMediaProtocol(paths.covers)
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
        .then((reports) => {
          if (!reports.length) return
          broadcast('library:changed', { reason: 'sync' })
          ctx?.onSynced()
        })
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
