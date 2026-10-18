import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import pkg from '../package.json'
import journal from '../drizzle/meta/_journal.json'

test('opens a single window titled "Shelf"', async ({ app, page }) => {
  expect(app.windows()).toHaveLength(1)
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())
  ).toBe('Shelf')
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible()
  await expect(page.getByTestId('library-empty')).toBeVisible()
})

test('renderer is isolated from Node', async ({ page }) => {
  const globals = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    shelf: typeof window.shelf
  }))
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', shelf: 'object' })
})

test('typed IPC ping answers pong', async ({ page }) => {
  const response = await page.evaluate(() => window.shelf.invoke('app:ping'))
  expect(response.ok).toBe(true)
  if (response.ok) expect(response.data.message).toBe('pong')
})

test('unknown IPC channel is rejected by the preload', async ({ page }) => {
  const response = await page.evaluate(() =>
    // @ts-expect-error deliberately calling an undeclared channel
    window.shelf.invoke('app:does-not-exist')
  )
  expect(response).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
})

test('database is created in userData with migrations applied', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Réglages' }).click()
  await expect(page.getByTestId('ipc-status')).toHaveText('✓ IPC connecté')
  await expect(page.getByTestId('applied-migrations')).toHaveText(String(journal.entries.length))
  await expect(page.getByTestId('app-version')).toHaveText(pkg.version)
  expect(existsSync(join(userDataDir, 'shelf.db'))).toBe(true)
})

test('title bar is frameless and draggable', async ({ app, page }) => {
  const region = await page
    .getByTestId('title-bar')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
  expect(region).toBe('drag')
  // The native frame is gone: content starts at the very top of the window.
  const contentY = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    return win.getContentBounds().y - win.getBounds().y
  })
  expect(contentY).toBe(0)
})
