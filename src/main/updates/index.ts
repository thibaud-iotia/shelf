import { app, shell } from 'electron'
import type { AppUpdateState } from '../../shared/models'
import { paths } from '../platform/paths'
import { fileAttemptStore } from './attempt'
import { electronUpdater } from './electron-updater'
import { UpdateService, updateMode } from './service'
import { parseSimulation, simulatedUpdater } from './simulated'

/** The update service of the running app: electron-updater, or the e2e simulation. */
export function createUpdateService(options: {
  enabled: () => boolean
  onChange: (state: AppUpdateState) => void
}): UpdateService {
  const simulation = parseSimulation(process.env.SHELF_UPDATE_SIMULATE)
  const mode = simulation
    ? simulation.mode
    : updateMode({
        packaged: app.isPackaged,
        platform: process.platform,
        appImage: process.env.APPIMAGE
      })
  return new UpdateService({
    adapter: simulation
      ? simulatedUpdater(simulation.version)
      : mode === 'disabled'
        ? null
        : electronUpdater(),
    mode,
    currentVersion: app.getVersion(),
    platform: process.platform,
    enabled: options.enabled,
    onChange: options.onChange,
    attempts: fileAttemptStore(paths.updateAttempt()),
    // Looked up at call time: the e2e tests replace shell.openExternal.
    openExternal: (url) => shell.openExternal(url)
  })
}
