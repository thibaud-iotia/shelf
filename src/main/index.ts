import { app, dialog, safeStorage, shell } from 'electron'
import { createProviders } from './accounts'
import { AccountService } from './accounts/service'
import type { AppContext } from './context'
import { openDatabase } from './db/client'
import { broadcast, onBroadcast } from './events'
import { closeSession, discardUnfinishedSessions, listGames, openSession } from './games/repository'
import { launchGame, runningGameIds } from './launch/launch-game'
import { registerIpcHandlers } from './ipc/handlers'
import { ImportService } from './import/service'
import { GameRunner } from './launch/runner'
import { SteamWatcher } from './launch/steam-watch'
import { MediaCache } from './media/cache'
import { handleMediaProtocol, registerMediaScheme } from './media/protocol'
import { MetadataService, type EnrichTarget } from './metadata/service'
import { applyUserDataOverride, launcherLocations, paths } from './platform/paths'
import { SecretStore } from './secrets/store'
import { SettingsStore } from './settings/store'
import { createSources } from './sources'
import { applyLaunchAtStartup, ShelfTray, showMainWindow, startedHidden } from './system'
import { createMainWindow } from './window'

app.setName('Shelf')
applyUserDataOverride()
app.enableSandbox()
registerMediaScheme()

/** Delay between the end of a Steam game and the account sync. */
const STEAM_SYNC_DELAY_MS = 60_000

let ctx: AppContext | undefined
let tray: ShelfTray | undefined

function openWindow() {
  return createMainWindow({ hideOnClose: () => !!ctx?.settings.get('minimizeToTray') })
}

function createTray(context: AppContext): ShelfTray {
  const { db } = context.database
  const shelfTray = new ShelfTray({
    show: () => showMainWindow(openWindow),
    recentGames: () =>
      listGames(db)
        .filter((g) => g.lastPlayedAt && g.installState !== 'not_installed' && !g.hidden)
        .sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)
        .slice(0, 5),
    play: (gameId) => {
      launchGame(context, gameId).catch((error: unknown) =>
        console.warn('[tray] launch failed', error)
      )
    },
    quit: () => app.quit()
  })
  shelfTray.create()
  onBroadcast((event) => {
    if (event === 'library:changed') shelfTray.refresh()
  })
  return shelfTray
}

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
  const locations = launcherLocations()
  const steamWatch = new SteamWatcher({ readRunningAppId: locations.steamRunningAppId })
  const running = () => broadcast('games:running', runningGameIds({ runner, steamWatch }))
  runner.on('change', running)
  steamWatch.on('change', running)

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

  // End of a Steam session: Steam updates its playtime, fetch it (the Web API lags a little).
  steamWatch.on('ended', () => {
    setTimeout(() => {
      void accounts.syncSource('steam').then((reports) => {
        if (!reports.length) return
        broadcast('library:changed', { reason: 'sync' })
        onSynced()
      })
    }, STEAM_SYNC_DELAY_MS)
  })

  return {
    database,
    settings,
    runner,
    steamWatch,
    importer,
    secrets,
    accounts,
    metadata,
    onSynced
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow(openWindow))

  app
    .whenReady()
    .then(() => {
      ctx = createContext()
      handleMediaProtocol(paths.covers)
      registerIpcHandlers(ctx)
      createMainWindow({
        hideOnClose: () => !!ctx?.settings.get('minimizeToTray'),
        startHidden: startedHidden() && ctx.settings.get('minimizeToTray')
      })
      try {
        tray = createTray(ctx)
      } catch (error) {
        // No system tray (some Linux desktops): everything else keeps working.
        console.warn('[startup] tray unavailable', error)
      }
      applyLaunchAtStartup(ctx.settings.get('launchAtStartup'))
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
        showMainWindow(openWindow)
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
  // With the tray, closing the window only hides it (handled in window.ts).
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  tray?.destroy()
  ctx?.runner.dispose()
  ctx?.steamWatch.dispose()
  ctx?.database.close()
})
