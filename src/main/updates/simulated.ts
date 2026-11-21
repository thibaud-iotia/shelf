import type { AppUpdateMode } from '../../shared/models'
import type { UpdaterAdapter } from './service'

/**
 * `SHELF_UPDATE_SIMULATE=<version>` (auto mode) or `manual:<version>`: a fake feed announcing
 * `version`, for the e2e tests (the unpackaged app has no update feed). The "install" only
 * records itself in `globalThis.__shelfUpdateInstalled`.
 */
export function parseSimulation(
  value: string | undefined
): { mode: AppUpdateMode; version: string } | null {
  const match = value?.trim().match(/^(?:(auto|manual):)?(\d+\.\d+\.\d+)$/)
  if (!match) return null
  return { mode: (match[1] as AppUpdateMode | undefined) ?? 'auto', version: match[2]! }
}

export function simulatedUpdater(version: string, stepMs = 150): UpdaterAdapter {
  const wait = () => new Promise((resolve) => setTimeout(resolve, stepMs))
  return {
    async check() {
      await wait()
      return {
        version,
        files: [
          `Shelf-${version}-win-x64.exe`,
          `Shelf-${version}-mac-arm64.dmg`,
          `Shelf-${version}-linux-amd64.deb`
        ]
      }
    },
    async download(onProgress) {
      for (const percent of [25, 60, 100]) {
        await wait()
        onProgress(percent)
      }
    },
    install() {
      Object.assign(globalThis, { __shelfUpdateInstalled: true })
    }
  }
}
