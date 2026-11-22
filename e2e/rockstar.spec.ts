import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from './fixtures'

test.describe('Rockstar Games Launcher', () => {
  // Uninstall entries saved as `reg query` output, the launcher's logs and a saves folder.
  const root = mkdtempSync(join(tmpdir(), 'shelf-rockstar-'))
  cpSync(resolve('tests/fixtures/rockstar'), join(root, 'rockstar'), { recursive: true })
  test.use({ launcherRoot: root })
  test.afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('detects its games, their pending update and the playtime of its logs', async ({ page }) => {
    await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
    await expect(page.getByTestId('auto-count')).toHaveText('2 correspondances automatiques OK')
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await expect(page.getByTestId('game-count')).toHaveText('2 jeux')

    const sources = page.getByRole('navigation', { name: 'Navigation principale' })
    await expect(sources.getByRole('button', { name: /^Rockstar/ })).toContainText('2')

    // The table of the launcher's last start lists an update for GTA V.
    const gta = page.getByTestId('game-card').filter({ hasText: 'Grand Theft Auto V Legacy' })
    await expect(gta.getByTestId('update-badge')).toHaveText('⟳ Mise à jour')
    const rdr2 = page.getByTestId('game-card').filter({ hasText: 'Red Dead Redemption 2' })
    await expect(rdr2.getByTestId('update-badge')).toHaveCount(0)

    // Runs read from the logs: 1 h 30 each (a crash after 10 s does not count).
    await page.getByRole('button', { name: 'Grand Theft Auto V Legacy', exact: true }).click()
    await expect(page.getByTestId('playtime')).toHaveText('1 h 30')
    await expect(page.getByText('Rockstar · installé')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Red Dead Redemption 2', exact: true }).click()
    await expect(page.getByTestId('playtime')).toHaveText('1 h 30')
  })

  test('offers the Social Club account in the settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Réglages' }).click()
    await page.getByRole('button', { name: 'Comptes' }).click()
    const card = page.getByTestId('provider-rockstar-social')
    await expect(card).toContainText('Rockstar Games Social Club (non officiel)')
    await expect(card.getByRole('button', { name: 'Se connecter à Rockstar Games…' })).toBeVisible()
  })
})
