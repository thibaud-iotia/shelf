import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import {
  expect,
  LAUNCHER_FIXTURES,
  NODE_PATH,
  stubOpenDialog,
  stubSaveDialog,
  test
} from './fixtures'

const SAVES = resolve('tests/fixtures/saves/Celeste')

test('exports a game save folder as a zip', async ({ app, page, userDataDir }) => {
  await page.evaluate(
    (exe) => window.shelf.invoke('games:create', { title: 'Celeste', executablePath: exe }),
    NODE_PATH
  )
  await page.reload()
  await page.getByRole('button', { name: 'Celeste', exact: true }).click()
  await expect(page.getByTestId('save-path')).toHaveText('Aucun dossier défini')

  await stubOpenDialog(app, SAVES)
  await page.getByRole('button', { name: 'Choisir le dossier…' }).click()
  await expect(page.getByTestId('save-path')).toHaveText(SAVES)

  const zip = join(userDataDir, 'celeste-backup.zip')
  await stubSaveDialog(app, zip)
  await page.getByRole('button', { name: 'Exporter (.zip)…' }).click()
  await expect(page.getByTestId('toast-success')).toContainText('3 fichiers')
  expect(existsSync(zip)).toBe(true)
  expect(Object.keys(unzipSync(readFileSync(zip))).sort()).toEqual([
    '0.celeste',
    'settings.celeste',
    'slots/slot1.dat'
  ])
})

test('closing the window keeps Shelf in the system tray when enabled', async ({ app, page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'Système' }).click()
  await page.getByText('Fermer la fenêtre réduit Shelf dans la barre système').click()
  await expect(page.getByRole('switch', { name: /Fermer la fenêtre/ })).toBeChecked()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          visible: w.isVisible(),
          destroyed: w.isDestroyed()
        }))
      )
    )
    .toEqual([{ visible: false, destroyed: false }])

  // A second launch (or the tray) brings it back.
  await app.evaluate(({ app: electronApp }) => electronApp.emit('second-instance'))
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()))
    .toBe(true)
})

test.describe('launcher games', () => {
  test.use({ launcherRoot: LAUNCHER_FIXTURES })

  test('Steam games can be uninstalled through the launcher', async ({ app, page }) => {
    await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await page.getByRole('button', { name: 'Hades', exact: true }).click()

    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await page.getByRole('button', { name: 'Désinstaller…' }).click()
    await page.getByRole('button', { name: '▶ Jouer' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['steam://uninstall/1145360', 'steam://rungameid/1145360'])
  })
})
