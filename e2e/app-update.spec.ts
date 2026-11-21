import { expect, launchShelf, stubFetch, test } from './fixtures'
import pkg from '../package.json'

// Updates of Shelf itself. The unpackaged app has no update feed: SHELF_UPDATE_SIMULATE
// replaces electron-updater with a fake feed announcing 9.9.9 (see main/updates/simulated.ts).

async function openAbout(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'À propos' }).click()
}

test('development build: updates are off, nothing is shown', async ({ page }) => {
  await openAbout(page)
  const card = page.getByTestId('updates-card')
  await expect(card).toContainText(`Version ${pkg.version}`)
  await expect(card).toContainText('Version de développement')
  await expect(card.getByRole('button', { name: 'Rechercher des mises à jour' })).toHaveCount(0)
  await expect(page.getByTestId('update-banner')).toHaveCount(0)
  const response = await page.evaluate(() => window.shelf.invoke('updater:check'))
  expect(response).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } })
})

test.describe('installable in place (Windows, AppImage)', () => {
  test.use({ appEnv: { SHELF_UPDATE_SIMULATE: '9.9.9' } })

  test('downloads in the background, then restarts on the new version', async ({ app, page }) => {
    await openAbout(page)
    const card = page.getByTestId('updates-card')
    await card.getByRole('button', { name: 'Rechercher des mises à jour' }).click()

    const banner = page.getByTestId('update-banner')
    await expect(banner).toHaveAttribute('data-phase', 'ready')
    await expect(banner).toContainText('Shelf 9.9.9')
    await expect(page.getByTestId('update-status')).toContainText('Shelf 9.9.9 est prête')
    await expect(
      page.getByText('Shelf 9.9.9 est prête : redémarrez pour l’installer.')
    ).toBeVisible()
    await expect(
      card.getByRole('link', { name: 'Nouveautés de la version 9.9.9' })
    ).toHaveAttribute('href', 'https://github.com/thibaud-iotia/shelf/releases/tag/v9.9.9')

    await banner.getByRole('button', { name: 'Redémarrer' }).click()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as { __shelfUpdateInstalled?: boolean }).__shelfUpdateInstalled
        )
      )
      .toBe(true)
  })

  test('restarted but still on the old version: the blocked install is reported', async ({
    app,
    page,
    userDataDir
  }) => {
    await openAbout(page)
    await page
      .getByTestId('updates-card')
      .getByRole('button', { name: 'Rechercher des mises à jour' })
      .click()
    await page.getByTestId('update-banner').getByRole('button', { name: 'Redémarrer' }).click()
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as { __shelfUpdateInstalled?: boolean }).__shelfUpdateInstalled
        )
      )
      .toBe(true)
    await app.close()

    // The simulated installer did nothing (like one quarantined by an antivirus): Shelf starts
    // again on the old version.
    const again = await launchShelf({ userDataDir, appEnv: { SHELF_UPDATE_SIMULATE: '9.9.9' } })
    try {
      await stubFetch(again, [])
      await again.evaluate(({ shell }) => {
        const opened: string[] = []
        ;(globalThis as { opened?: string[] }).opened = opened
        shell.openExternal = async (url: string) => {
          opened.push(url)
        }
      })
      const window = await again.firstWindow()
      const banner = window.getByTestId('update-banner')
      await expect(banner).toHaveAttribute('data-phase', 'blocked')
      await expect(banner).toContainText('Shelf 9.9.9 ne s’est pas installée')
      await expect(banner).toContainText('antivirus')

      await banner.getByRole('button', { name: 'Télécharger' }).click()
      const releases = 'https://github.com/thibaud-iotia/shelf/releases'
      await expect
        .poll(() => again.evaluate(() => (globalThis as { opened?: string[] }).opened))
        .toEqual([
          process.platform === 'win32'
            ? `${releases}/download/v9.9.9/Shelf-9.9.9-win-x64.exe`
            : `${releases}/tag/v9.9.9`
        ])

      await banner.getByRole('button', { name: 'Ignorer' }).click()
      await expect(banner).toHaveCount(0)
    } finally {
      await again.close()
    }
  })

  test('the automatic check can be turned off', async ({ page }) => {
    await openAbout(page)
    const toggle = page.getByRole('switch', { name: /Rechercher automatiquement/ })
    await expect(toggle).toBeChecked()
    // Controlled switch: it flips once the setting is saved.
    await page.getByText('Rechercher automatiquement les mises à jour').click()
    await expect(toggle).not.toBeChecked()
    const settings = await page.evaluate(() => window.shelf.invoke('settings:get'))
    expect(settings).toMatchObject({ ok: true, data: { autoUpdateCheck: false } })
  })
})

test.describe('detection only (unsigned macOS, .deb)', () => {
  test.use({ appEnv: { SHELF_UPDATE_SIMULATE: 'manual:9.9.9' } })

  test('announces the version and opens its installer in the browser', async ({ app, page }) => {
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await openAbout(page)
    await page
      .getByTestId('updates-card')
      .getByRole('button', { name: 'Rechercher des mises à jour' })
      .click()

    const banner = page.getByTestId('update-banner')
    await expect(banner).toHaveAttribute('data-phase', 'available')
    await banner.getByRole('button', { name: 'Télécharger' }).click()

    // The platform's installer; the release page where there is none (Windows, simulated).
    const releases = 'https://github.com/thibaud-iotia/shelf/releases'
    const expected = {
      darwin: `${releases}/download/v9.9.9/Shelf-9.9.9-mac-arm64.dmg`,
      linux: `${releases}/download/v9.9.9/Shelf-9.9.9-linux-amd64.deb`,
      win32: `${releases}/download/v9.9.9/Shelf-9.9.9-win-x64.exe`
    }[process.platform as string]
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual([expected ?? `${releases}/tag/v9.9.9`])
  })
})
