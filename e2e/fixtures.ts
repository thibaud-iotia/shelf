import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'

interface Options {
  /** SHELF_LAUNCHER_ROOT: fake launcher data. Default: an empty folder (no launcher found). */
  launcherRoot: string | null
  /** Marks the onboarding as done before the test starts. Default true. */
  onboarded: boolean
}

interface Fixtures {
  userDataDir: string
  app: ElectronApplication
  page: Page
}

/** Fake Steam / Epic / GOG installs used by the detection tests. */
export const LAUNCHER_FIXTURES = resolve('tests/fixtures/launchers')
/** Folder of standalone games (one sub-folder per game). */
export const GAMES_FOLDER = resolve('tests/fixtures/folders/Games')

/** Launches the built app with an isolated, throwaway userData directory per test. */
export const test = base.extend<Fixtures & Options>({
  launcherRoot: [null, { option: true }],
  onboarded: [true, { option: true }],

  // eslint-disable-next-line no-empty-pattern
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'shelf-e2e-'))
    await use(dir)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  },
  app: async ({ userDataDir, launcherRoot }, use) => {
    // Drop dev-server / run-as-node variables so the built app starts normally.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined &&
          !['ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE'].includes(entry[0])
      )
    )
    env.SHELF_USER_DATA = userDataDir
    // Never read the real launchers of the machine running the tests.
    const noLaunchers = join(userDataDir, 'no-launchers')
    mkdirSync(noLaunchers, { recursive: true })
    env.SHELF_LAUNCHER_ROOT = launcherRoot ?? noLaunchers
    const app = await electron.launch({ args: [resolve('.')], env })
    await use(app)
    await app.close()
  },
  page: async ({ app, onboarded }, use) => {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    if (onboarded) {
      await page.evaluate(() => window.shelf.invoke('settings:update', { onboardingDone: true }))
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
    }
    await use(page)
  }
})

export { expect } from '@playwright/test'

/** Makes the next native "open" dialogs return `paths` (one per call, last one repeats). */
export async function stubOpenDialog(app: ElectronApplication, ...paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, queue) => {
    const pending = [...queue]
    dialog.showOpenDialog = (async () => {
      const next = pending.length > 1 ? pending.shift()! : pending[0]!
      return { canceled: false, filePaths: [next] }
    }) as typeof dialog.showOpenDialog
  }, paths)
}

/** Makes the next native "save" dialog return `path`. */
export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: target
    })) as typeof dialog.showSaveDialog
  }, path)
}

/** Stand-in game: `node fake-game.cjs <ms>` (see tests/fixtures). */
export const FAKE_GAME_SCRIPT = resolve('tests/fixtures/fake-game.cjs')
export const NODE_PATH = process.execPath
