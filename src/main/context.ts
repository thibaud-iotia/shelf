import type { AccountService } from './accounts/service'
import type { DatabaseHandle } from './db/client'
import type { UninstallWatcher } from './games/uninstall-watch'
import type { ImportService } from './import/service'
import type { InsightsService } from './insights/service'
import type { GameRunner } from './launch/runner'
import type { SteamWatcher } from './launch/steam-watch'
import type { MetadataService } from './metadata/service'
import type { SecretStore } from './secrets/store'
import type { SettingsStore } from './settings/store'
import type { StoreService } from './store/service'
import type { PurchaseWatcher } from './store/watcher'

/** Long-lived services shared by the IPC handlers. */
export interface AppContext {
  database: DatabaseHandle
  settings: SettingsStore
  runner: GameRunner
  /** Steam games launched through `steam://`, followed until they stop. */
  steamWatch: SteamWatcher
  importer: ImportService
  secrets: SecretStore
  accounts: AccountService
  metadata: MetadataService
  /** News, videos, reviews, community and achievements of the game page. */
  insights: InsightsService
  /** Queues artwork/metadata for games added by an account sync. */
  onSynced: () => void
  /** Re-reads the launchers' files: install states and pending updates (one run at a time). */
  checkUpdates: () => Promise<void>
  /** Games whose uninstall Shelf started, followed until the launcher removed them. */
  uninstallWatch: UninstallWatcher
  /** Wishlist, deals, prices and purchases through the launchers. */
  store: StoreService
  /** Purchases opened from the store, followed until the game is in the library. */
  purchases: PurchaseWatcher
}
