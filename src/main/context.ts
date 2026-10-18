import type { DatabaseHandle } from './db/client'
import type { GameRunner } from './launch/runner'
import type { SettingsStore } from './settings/store'

/** Long-lived services shared by the IPC handlers. */
export interface AppContext {
  database: DatabaseHandle
  settings: SettingsStore
  runner: GameRunner
}
