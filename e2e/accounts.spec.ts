import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, LAUNCHER_FIXTURES, test } from './fixtures'

test('accounts page validates input without touching the network', async ({ page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'Comptes' }).click()

  const steam = page.getByTestId('provider-steam')
  await expect(steam).toContainText('non connecté')
  await expect(steam).toContainText('« Détails des jeux » doit être public')
  await steam.getByLabel('Clé API Steam').fill('not-a-key')
  await steam.getByLabel('SteamID64 ou URL du profil').fill('gaben')
  await steam.getByRole('button', { name: 'Connecter Steam' }).click()
  await expect(steam.getByRole('alert')).toHaveText(
    'La clé API Steam fait 32 caractères hexadécimaux.'
  )

  // GOG option B stays hidden behind its flag.
  const gog = page.getByTestId('provider-gog-oauth')
  await expect(gog.getByRole('button', { name: 'Se connecter à GOG…' })).toHaveCount(0)
  await gog.getByText('Activer la connexion au compte GOG').click()
  await expect(gog.getByRole('button', { name: 'Se connecter à GOG…' })).toBeVisible()

  // Galaxy is not installed in the fixture root: a clear message, nothing breaks.
  const galaxy = page.getByTestId('provider-gog-galaxy')
  await galaxy.getByRole('button', { name: 'Lire la bibliothèque GOG Galaxy' }).click()
  await expect(galaxy.getByRole('alert')).toContainText('GOG Galaxy introuvable')
})

test.describe('uninstalled launcher games', () => {
  // A private copy of the launcher fixtures that the test can modify.
  const root = mkdtempSync(join(tmpdir(), 'shelf-launchers-'))
  cpSync(LAUNCHER_FIXTURES, root, { recursive: true })
  test.use({ launcherRoot: root })
  test.afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('become "not installed" and offer the launcher install page', async ({ app, page }) => {
    await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await expect(page.getByTestId('game-count')).toHaveText('4 jeux')

    rmSync(join(root, 'steam', 'steamapps', 'appmanifest_1145360.acf'))
    await page.getByRole('button', { name: 'Détecter les jeux' }).click()
    await page.getByRole('button', { name: /^Tout importer/ }).click()

    await page.getByRole('button', { name: 'Hades', exact: true }).click()
    await expect(page.getByText('Steam · non installé')).toBeVisible()

    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await page.getByRole('button', { name: 'Installer' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['steam://install/1145360'])
  })
})
