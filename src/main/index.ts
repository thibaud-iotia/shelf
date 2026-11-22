import { app, dialog, safeStorage, shell } from 'electron'
import type { GameSourceId } from '../shared/domain'
import { createProviders } from './accounts'
import { AccountService } from './accounts/service'
import type { AppContext } from './context'
import { openDatabase } from './db/client'
import { broadcast, onBroadcast } from './events'
import {
  closeSession,
  discardUnfinishedSessions,
  getGameRow,
  installStatus,
  listGames,
  markNotInstalled,
  openSession
} from './games/repository'
import { importRockstarSessions } from './games/rockstar-sessions'
import { UninstallWatcher } from './games/uninstall-watch'
import { followSteamLaunches, launchGame, runningGameIds } from './launch/launch-game'
import { registerIpcHandlers } from './ipc/handlers'
import { ImportService } from './import/service'
import { LegendaryInstaller } from './install/legendary'
import { RockstarLauncher } from './install/rockstar'
import { InstallService } from './install/service'
import { SteamInstaller } from './install/steam'
import { steamClientControl } from './install/steam-client'
import { readTail, steamContentLog } from './install/steam-log'
import { processWriteMeter } from './platform/process-io'
import { anyProcessRunning } from './platform/processes'
import { RockstarWatcher } from './launch/rockstar-watch'
import { launchRequests, readRockstarLogs, readSessions } from './sources/rockstar-log'
import { LaunchTracker } from './launch/progress'
import { GameRunner } from './launch/runner'
import { SteamWatcher } from './launch/steam-watch'
import { MediaCache } from './media/cache'
import { allowYouTubeEmbeds } from './media/embeds'
import { handleMediaProtocol, registerMediaScheme } from './media/protocol'
import { RemoteImageCache } from './media/remote'
import { shrinkWithNativeImage } from './media/shrink'
import { InsightsService } from './insights/service'
import { MetadataService, type EnrichTarget } from './metadata/service'
import { applyUserDataOverride, launcherLocations, paths } from './platform/paths'
import { SecretStore } from './secrets/store'
import { SettingsStore } from './settings/store'
import { createSources } from './sources'
import { steamSource } from './sources/steam'
import { prewarmDelay, StoreService } from './store/service'
import { PurchaseWatcher } from './store/watcher'
import { dropBought, ownedIndex } from './store/wishlist'
import { applyLaunchAtStartup, ShelfTray, showMainWindow, startedHidden } from './system'
import { createUpdateService } from './updates'
import { createMainWindow } from './window'

app.setName('Shelf')
applyUserDataOverride()
app.enableSandbox()
registerMediaScheme()

/** Delay between the end of a Steam game and the account sync. */
const STEAM_SYNC_DELAY_MS = 60_000
/** Launchers' files are re-read this often: install states and pending updates. */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000
/** Background artwork: at most one library refresh this often. */
const PROGRESS_MS = 500

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
  const steamWatch = new SteamWatcher({ readStatus: locations.steamStatus })
  // Rockstar Games Launcher: its current log tells the game it starts and when it exits.
  const rockstarWatch = new RockstarWatcher({
    readStatus: async (since) => {
      const entries = await readRockstarLogs(locations.rockstarLogDir, 1)
      return {
        openSessions: readSessions(entries)
          .filter((s) => s.endedAt === null)
          .map((s) => s.path),
        requested: launchRequests(entries, since)
      }
    },
    ...(process.platform === 'win32' ? { isRunning: anyProcessRunning } : {})
  })
  const running = () =>
    broadcast('games:running', runningGameIds({ runner, steamWatch, rockstarWatch }))
  runner.on('change', running)
  steamWatch.on('change', running)
  rockstarWatch.on('change', running)

  // From the click on "Jouer" to the game running: what the UI shows meanwhile.
  const launches = new LaunchTracker()
  launches.on('change', (list) => broadcast('games:launching', list))
  const launchTimeout = (gameId: number, launcher: GameSourceId | null) => {
    try {
      const { title } = getGameRow(db, gameId)
      broadcast('games:launchTimeout', { gameId, title, launcher })
    } catch {
      // Deleted meanwhile: nothing to tell.
    }
  }
  followSteamLaunches(launches, steamWatch, launchTimeout)
  followSteamLaunches(launches, rockstarWatch, launchTimeout)

  const settings = new SettingsStore(db)
  const secrets = new SecretStore(paths.secrets(), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  const metadata = new MetadataService(
    db,
    secrets,
    new MediaCache(paths.covers(), undefined, shrinkWithNativeImage)
  )

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
  // Covers arrive several per second: one library refresh every PROGRESS_MS at most.
  let progressTimer: NodeJS.Timeout | null = null
  const progress = () => {
    progressTimer ??= setTimeout(() => {
      progressTimer = null
      broadcast('library:changed', { reason: 'metadata' })
    }, PROGRESS_MS)
  }
  const enrich = (targets: EnrichTarget[]) => enqueue(() => metadata.enrich(targets, progress))

  const importer = new ImportService(db, settings, createSources(launcherLocations), enrich)
  const accounts = new AccountService(db, secrets, createProviders(launcherLocations), {
    // GOG option B stays behind its flag.
    isEnabled: (kind) => kind !== 'gog-oauth' || settings.get('gogOAuthEnabled')
  })
  const onSynced = () => enqueue(() => metadata.enrichMissing(progress))
  const compactMedia = () => enqueue(() => metadata.compactCache(progress))

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

  // Rockstar playtime: the game runs of the launcher's logs become play sessions.
  const importRockstarPlay = async () => {
    if (!locations.rockstarLogDir) return 0
    const added = importRockstarSessions(
      db,
      readSessions(await readRockstarLogs(locations.rockstarLogDir))
    )
    if (added) broadcast('library:changed', { reason: 'session' })
    return added
  }
  rockstarWatch.on('ended', () => {
    void importRockstarPlay().catch((error: unknown) =>
      console.warn('[rockstar] session import failed', error)
    )
  })

  // Launcher files (install states, pending updates): one read at a time, shared by callers.
  let checking: Promise<void> | null = null
  const checkUpdates = () =>
    (checking ??= importer
      .refreshInstalled()
      .then(async (report) => {
        if (report) broadcast('library:changed', { reason: 'refresh' })
        await importRockstarPlay().catch((error: unknown) =>
          console.warn('[rockstar] session import failed', error)
        )
      })
      .finally(() => {
        checking = null
      }))

  // Uninstalls started from Shelf: re-read the launchers until the game is seen uninstalled.
  const uninstallWatch = new UninstallWatcher({
    refresh: checkUpdates,
    state: (gameId) => installStatus(db, gameId),
    markUninstalled: (gameId) => markNotInstalled(db, gameId),
    onUninstalled: () => broadcast('library:changed', { reason: 'uninstall' })
  })

  // Installs without the launcher's window: Steam (manifest + restart in the tray), Epic
  // through Legendary. The library is re-read once the game is on disk.
  const steamRoot = () => steamSource(locations.steamRoots).locate()
  const steamInstaller = new SteamInstaller({
    root: steamRoot,
    control: steamClientControl({
      status: locations.steamStatus,
      executable: locations.steamExecutable,
      // Looked up at call time: the e2e tests replace shell.openExternal.
      openExternal: (uri) => shell.openExternal(uri)
    })
  })
  const rockstar = new RockstarLauncher({
    launcher: locations.rockstarLauncher,
    uninstallKeys: locations.rockstarUninstallKeys,
    logDir: () => locations.rockstarLogDir
  })
  const installs = new InstallService({
    steam: steamInstaller,
    legendary: new LegendaryInstaller({ binaries: () => launcherLocations().legendaryBinaries }),
    rockstar,
    enabled: () => settings.get('backgroundInstall'),
    defaultPath: (source) => settings.get('installPaths')[source],
    // Live progress of Steam downloads: the appmanifest only gets it when they stop.
    steamLog: async () => {
      const root = await steamRoot()
      return root ? readTail(steamContentLog(root), 128 * 1024) : null
    },
    steamWrites: processWriteMeter('steam'),
    openExternal: (uri) => shell.openExternal(uri),
    refresh: checkUpdates,
    onChange: (list) => broadcast('games:installing', list),
    onEnded: (game, outcome, error) => {
      if (outcome === 'installed') broadcast('library:changed', { reason: 'install' })
      broadcast('games:installEnded', {
        gameId: game.id,
        title: game.title,
        outcome,
        ...(error ? { error } : {})
      })
    }
  })

  const insights = new InsightsService({
    db,
    steamCredentials: () => accounts.steamCredentials(),
    igdbExtras: (igdbId) => metadata.extras(igdbId)
  })

  // Store purchases: payment happens in the launcher; when the game shows up (account sync or
  // launcher files), it leaves the wishlist and the renderer shows a toast.
  const purchases = new PurchaseWatcher({
    refresh: async (sources) => {
      if (sources.includes(null)) await accounts.syncAll()
      else for (const source of sources) if (source) await accounts.syncSource(source)
      await checkUpdates()
      broadcast('library:changed', { reason: 'sync' })
      onSynced()
    },
    findOwned: (purchase) => ownedIndex(db).find(purchase),
    onPurchased: (purchase, gameId) => {
      dropBought(db, purchase)
      broadcast('store:purchased', { title: purchase.title, gameId })
    }
  })
  const store = new StoreService({
    db,
    steamId: () => accounts.steamCredentials()?.steamId ?? null,
    launcherAvailable: (source) => importer.isAvailable(source),
    // Looked up at call time: the e2e tests replace shell.openExternal.
    openExternal: (url) => shell.openExternal(url),
    watchPurchase: (purchase) => purchases.add(purchase),
    userAgent: `Shelf/${app.getVersion()} (+https://github.com/thibaud-iotia/shelf)`
  })

  // Shelf's own updates (GitHub Releases): downloaded in the background, installed on restart.
  const updater = createUpdateService({
    enabled: () => settings.get('autoUpdateCheck'),
    onChange: (state) => broadcast('updater:changed', state)
  })

  return {
    database,
    settings,
    runner,
    steamWatch,
    rockstarWatch,
    launches,
    importer,
    secrets,
    accounts,
    metadata,
    insights,
    onSynced,
    compactMedia,
    checkUpdates,
    importPlaySessions: importRockstarPlay,
    installs,
    rockstar,
    uninstallWatch,
    store,
    purchases,
    updater
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
      const remoteImages = new RemoteImageCache()
      handleMediaProtocol(paths.covers, remoteImages)
      allowYouTubeEmbeds()
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
      // Keep install states and pending updates fresh: at startup (games installed, removed or
      // updated while Shelf was closed), then periodically (launchers queue updates any time).
      const refresh = () =>
        void ctx?.checkUpdates().catch((error: unknown) => console.warn('[refresh] failed', error))
      refresh()
      setInterval(refresh, UPDATE_CHECK_INTERVAL_MS).unref()
      // Steam installs queued before Shelf last quit: followed again.
      void ctx.installs
        .resume(
          listGames(ctx.database.db).filter(
            (g) => g.source === 'steam' && g.installState !== 'installed'
          )
        )
        .catch((error: unknown) => console.warn('[startup] install resume failed', error))
      // Owned libraries: automatic sync when the last one is older than 24 h.
      void ctx.accounts
        .syncDue()
        .then((reports) => {
          if (!reports.length) return
          broadcast('library:changed', { reason: 'sync' })
          ctx?.onSynced()
        })
        .catch((error: unknown) => console.warn('[startup] sync failed', error))
        // After the new covers: artwork downloaded at full size by older versions.
        .finally(() => ctx?.compactMedia())

      // Store: deals, wishlist and first images fetched in the background once the library is
      // shown, so the first visit to "Boutique" does not wait for the network.
      const storeDelay = prewarmDelay(process.env.SHELF_STORE_PREWARM_MS)
      if (storeDelay !== null) {
        setTimeout(() => {
          void ctx?.store.prewarm((url) => remoteImages.get(url))
        }, storeDelay).unref()
      }

      // New version of Shelf: first check shortly after startup, then every 4 h.
      ctx.updater.start()

      // Back from the launcher's checkout: look for the game bought from the store.
      app.on('browser-window-focus', () => ctx?.purchases.nudge())

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
  ctx?.rockstarWatch.dispose()
  ctx?.launches.dispose()
  ctx?.uninstallWatch.dispose()
  ctx?.installs.dispose()
  ctx?.purchases.dispose()
  ctx?.updater.dispose()
  ctx?.database.close()
})
