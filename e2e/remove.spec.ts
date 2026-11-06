import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, LAUNCHER_FIXTURES, test } from './fixtures'

// A private copy of the launcher fixtures: Steam "uninstalls" Hades by deleting its manifest.
const root = mkdtempSync(join(tmpdir(), 'shelf-remove-'))
cpSync(LAUNCHER_FIXTURES, root, { recursive: true })
test.use({ launcherRoot: root })
test.afterAll(() => rmSync(root, { recursive: true, force: true }))

test('uninstalls a Steam game through Steam, then removes it from the library', async ({
  app,
  page
}) => {
  await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
  await page.getByRole('button', { name: /^Tout importer/ }).click()
  await expect(page.getByTestId('game-count')).toHaveText('4 jeux')

  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })

  const hades = page.getByTestId('game-card').filter({ hasText: 'Hades' })
  await hades.click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Actions pour Hades' })
    .getByRole('menuitem', { name: 'Supprimer…' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Supprimer « Hades »' })
  await dialog.getByRole('button', { name: 'Désinstaller…' }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['steam://uninstall/1145360'])
  await expect(dialog).toBeHidden()

  // Steam removes the game: Shelf sees it without a manual check.
  await page.getByRole('button', { name: 'Hades', exact: true }).click()
  rmSync(join(root, 'steam', 'steamapps', 'appmanifest_1145360.acf'))
  await expect(page.getByText('Désinstallation terminée : bibliothèque à jour.')).toBeVisible({
    timeout: 15_000
  })
  await expect(page.getByText('Steam · non installé')).toBeVisible()

  // From the game page this time: removed from Shelf, back to the library.
  await page.getByRole('button', { name: 'Supprimer…' }).click()
  await dialog.getByRole('button', { name: 'Retirer', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(page.getByText('« Hades » retiré de la bibliothèque')).toBeVisible()
  await expect(page.getByTestId('game-count')).toHaveText('3 jeux')
})
