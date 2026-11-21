import { autoUpdater as lazyAutoUpdater, type AppUpdater } from 'electron-updater'
import type { FoundUpdate, UpdaterAdapter } from './service'

/**
 * electron-updater, configured by `app-update.yml` (written into resources/ by electron-builder
 * from the `publish` section of electron-builder.yml). It reads `latest.yml` /
 * `latest-linux.yml` / `latest-mac.yml` from the latest GitHub release, downloads the installer
 * (differentially when the previous `.blockmap` is there), verifies its sha512, then runs it
 * silently on restart: NSIS reuses the install folder and leaves userData alone.
 *
 * Exception to "network only through net/http.ts": electron-updater has its own HTTP client
 * (Electron's net module), limited to github.com and its release CDN. Not used in tests.
 */
export function electronUpdater(): UpdaterAdapter {
  let instance: AppUpdater | null = null
  // `autoUpdater` is a getter that creates the platform's updater (NsisUpdater,
  // AppImageUpdater…): read on first use only. Static import: a dynamic import() does not
  // see this CommonJS getter as a named export.
  const updater = (): AppUpdater => {
    if (instance) return instance
    const autoUpdater = lazyAutoUpdater
    // Shelf decides when to download (and only in `auto` mode).
    autoUpdater.autoDownload = false
    // Downloaded but not restarted: installed silently when Shelf quits.
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    // Without a listener, EventEmitter would throw the error out of the main process; the
    // rejected promises already carry it to UpdateService.
    autoUpdater.on('error', (error) => console.warn('[updater]', error.message))
    return (instance = autoUpdater)
  }

  return {
    async check(): Promise<FoundUpdate | null> {
      const result = await updater().checkForUpdates()
      if (!result?.isUpdateAvailable) return null
      return {
        version: result.updateInfo.version,
        files: result.updateInfo.files.map((file) => file.url)
      }
    },
    async download(onProgress) {
      const autoUpdater = updater()
      const listener = (progress: { percent: number }) => onProgress(progress.percent)
      autoUpdater.on('download-progress', listener)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.off('download-progress', listener)
      }
    },
    install() {
      // Silent installer, Shelf restarted afterwards. Only called once downloaded.
      updater().quitAndInstall(true, true)
    }
  }
}
