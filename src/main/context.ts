import type { AccountService } from './accounts/service'
import type { DatabaseHandle } from './db/client'
import type { ImportService } from './import/service'
import type { GameRunner } from './launch/runner'
import type { SecretStore } from './secrets/store'
import type { SettingsStore } from './settings/store'

/** Long-lived services shared by the IPC handlers. */
export interface AppContext {
  database: DatabaseHandle
  settings: SettingsStore
  runner: GameRunner
  importer: ImportService
  secrets: SecretStore
  accounts: AccountService
}
