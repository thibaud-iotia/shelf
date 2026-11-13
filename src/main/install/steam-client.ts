import { spawn } from 'node:child_process'
import type { SteamStatus } from '../sources/steam-running'
import type { SteamClientControl } from './steam'

export interface SteamClientDeps {
  status: (appIds: number[]) => Promise<SteamStatus>
  /** Steam client executable (Windows); null: Shelf goes through `steam://` URIs. */
  executable: () => Promise<string | null>
  openExternal: (uri: string) => Promise<void>
  run?: (command: string, args: string[]) => Promise<void>
}

/** Starts a detached process and returns once it is running (Steam keeps running on its own). */
function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', reject)
  })
}

/**
 * Drives the Steam client with its own command line: `-shutdown` asks the running client to
 * quit, `-silent` starts it in the tray. Without the executable (macOS, Linux, tests), the URIs
 * do the same: `steam://exit`, and `steam://open/downloads` which starts Steam on its downloads.
 */
export function steamClientControl(deps: SteamClientDeps): SteamClientControl {
  const run = deps.run ?? runDetached
  return {
    status: deps.status,
    async shutdown() {
      const exe = await deps.executable()
      if (exe) {
        try {
          return await run(exe, ['-shutdown'])
        } catch {
          // Fall through to the URI.
        }
      }
      await deps.openExternal('steam://exit')
    },
    async start() {
      const exe = await deps.executable()
      if (exe) {
        try {
          return await run(exe, ['-silent'])
        } catch {
          // Fall through to the URI.
        }
      }
      await deps.openExternal('steam://open/downloads')
    }
  }
}
