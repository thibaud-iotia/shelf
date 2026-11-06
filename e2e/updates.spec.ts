import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, LAUNCHER_FIXTURES, test } from './fixtures'

test.describe('pending launcher updates', () => {
  // A private copy of the launcher fixtures that the test can modify.
  const root = mkdtempSync(join(tmpdir(), 'shelf-updates-'))
  cpSync(LAUNCHER_FIXTURES, root, { recursive: true })
  test.use({ launcherRoot: root })
  test.afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('are detected, shown and opened in the launcher', async ({ app, page }) => {
    await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await expect(page.getByTestId('game-count')).toHaveText('4 jeux')
    await expect(page.getByTestId('update-badge')).toHaveCount(0)

    // Steam queues an update for Hades: "update required", a newer build announced.
    writeFileSync(
      join(root, 'steam', 'steamapps', 'appmanifest_1145360.acf'),
      `"AppState"
{
	"appid"		"1145360"
	"name"		"Hades"
	"StateFlags"		"6"
	"installdir"		"Hades"
	"buildid"		"100"
	"TargetBuildID"		"101"
}
`
    )
    await page.getByRole('button', { name: '⟳ Vérifier les mises à jour' }).click()
    await expect(page.getByText('1 jeu a une mise à jour en attente.')).toBeVisible()

    const hades = page.getByTestId('game-card').filter({ hasText: 'Hades' })
    await expect(hades.getByTestId('update-badge')).toHaveText('⟳ Mise à jour')
    await page.getByRole('button', { name: '⟳ Mises à jour · 1' }).click()
    await expect(page.getByTestId('game-card')).toHaveCount(1)

    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    await page.getByRole('button', { name: 'Hades', exact: true }).click()
    await page.getByRole('button', { name: '⟳ Mettre à jour' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['steam://open/downloads'])
  })
})
