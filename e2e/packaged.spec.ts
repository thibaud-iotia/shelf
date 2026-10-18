import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import journal from '../drizzle/meta/_journal.json'
import pkg from '../package.json'

// Smoke test of the installed layout (asar, extraResources, unpacked better-sqlite3).
// Runs only with SHELF_PACKAGED=<path to the packaged executable>, see `npm run test:packaged`.
const executable = process.env.SHELF_PACKAGED

test.skip(!executable, 'SHELF_PACKAGED not set')

test('packaged app starts, migrates its database and finds its resources', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'shelf-packaged-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RUN_AS_NODE'
    )
  )
  const app = await electron.launch({
    executablePath: resolve(executable!),
    env: { ...env, SHELF_USER_DATA: userData, SHELF_LAUNCHER_ROOT: join(userData, 'none') }
  })
  try {
    const page = await app.firstWindow()
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)
    const info = await page.evaluate(() => window.shelf.invoke('app:info'))
    expect(info).toMatchObject({
      ok: true,
      data: { version: pkg.version, appliedMigrations: journal.entries.length }
    })
    expect(existsSync(join(userData, 'shelf.db'))).toBe(true)
    const resources = await app.evaluate(() => process.resourcesPath)
    expect(existsSync(join(resources, 'resources', 'tray.png'))).toBe(true)
    expect(existsSync(join(resources, 'drizzle', 'meta', '_journal.json'))).toBe(true)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
