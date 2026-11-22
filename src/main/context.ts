import type { AccountService } from './accounts/service'
import type { DatabaseHandle } from './db/client'
import type { UninstallWatcher } from './games/uninstall-watch'
import type { ImportService } from './import/service'
import type { RockstarLauncher } from './install/rockstar'
import type { InstallService } from './install/service'
import type { InsightsService } from './insights/service'
import type { LaunchTracker } from './launch/progress'
import type { RockstarWatcher } from './launch/rockstar-watch'
import type { GameRunner } from './launch/runner'
import type { SteamWatcher } from './launch/steam-watch'
import type { MetadataService } from './metadata/service'
import type { SecretStore } from './secrets/store'
import type { SettingsStore } from './settings/store'
import type { StoreService } from './store/service'
import type { PurchaseWatcher } from './store/watcher'
import type { UpdateService } from './updates/service'

/** Long-lived services shared by the IPC handlers. */
export interface AppContext {
  database: DatabaseHandle
  settings: SettingsStore
  runner: GameRunner
  /** Steam games launched through `steam://`, followed until they stop. */
  steamWatch: SteamWatcher
  /** Games handed to the Rockstar Games Launcher, followed through its log until they stop. */
  rockstarWatch: RockstarWatcher
  /** Launches between the click on "Jouer" and the game running (shown in the UI). */
  launches: LaunchTracker
  importer: ImportService
  secrets: SecretStore
  accounts: AccountService
  metadata: MetadataService
  /** News, videos, reviews, community and achievements of the game page. */
  insights: InsightsService
  /** Queues artwork/metadata for games added by an account sync. */
  onSynced: () => void
  /** Queues the shrinking of artwork downloaded at full size by older versions. */
  compactMedia: () => void
  /** Re-reads the launchers' files: install states and pending updates (one run at a time). */
  checkUpdates: () => Promise<void>
  /** Reads the play sessions of launchers' logs (Rockstar Games Launcher); returns how many. */
  importPlaySessions: () => Promise<number>
  /** Installs in the background (Steam, Epic via Legendary), followed until done. */
  installs: InstallService
  /** `Launcher.exe` of the Rockstar Games Launcher: install, uninstall, open. */
  rockstar: RockstarLauncher
  /** Games whose uninstall Shelf started, followed until the launcher removed them. */
  uninstallWatch: UninstallWatcher
  /** Wishlist, deals, prices and purchases through the launchers. */
  store: StoreService
  /** Purchases opened from the store, followed until the game is in the library. */
  purchases: PurchaseWatcher
  /** Updates of Shelf itself (GitHub Releases): check, background download, restart. */
  updater: UpdateService
}
