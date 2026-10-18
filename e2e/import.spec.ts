import { expect, GAMES_FOLDER, LAUNCHER_FIXTURES, stubOpenDialog, test } from './fixtures'

test.describe('first run', () => {
  test.use({ onboarded: false, launcherRoot: LAUNCHER_FIXTURES })

  test('onboarding detects launchers, scans a folder and imports', async ({ app, page }) => {
    // Mockup 05: launchers found from the fixture installs.
    await expect(page.getByRole('heading', { name: 'On a trouvé vos launchers' })).toBeVisible()
    await expect(page.getByTestId('launcher-steam')).toContainText('2 jeux')
    await expect(page.getByTestId('launcher-steam')).toContainText('✓ Inclus')
    await expect(page.getByTestId('launcher-epic')).toContainText('1 jeu')
    await expect(page.getByTestId('launcher-gog')).toContainText('1 jeu')
    await expect(page.getByTestId('launcher-itch')).toContainText('Non détecté')

    // Exclude Epic.
    await page.getByTestId('launcher-epic').click()
    await expect(page.getByTestId('launcher-epic')).toContainText('Exclu')

    await page.getByRole('button', { name: 'Suivant →' }).click()
    await expect(page.getByRole('heading', { name: 'Métadonnées et jaquettes' })).toBeVisible()
    await page.getByRole('button', { name: 'Suivant →' }).click()

    await stubOpenDialog(app, GAMES_FOLDER)
    await page.getByRole('button', { name: '+ Ajouter un dossier…' }).click()
    await expect(page.getByTestId('scan-folders')).toContainText(GAMES_FOLDER)

    await page.getByRole('button', { name: 'Lancer la détection' }).click()

    // Mockup 04: launcher games are auto OK, folder finds need a look.
    await expect(page.getByRole('heading', { name: 'Jeux détectés' })).toBeVisible()
    await expect(page.getByTestId('auto-count')).toHaveText('3 correspondances automatiques OK')
    // Hollow, Celeste (Epic excluded → plain folder find), Doom, Retro Pack.
    await expect(page.getByTestId('review-count')).toHaveText('À vérifier (4)')
    await expect(page.getByTestId('candidate-excluded')).toHaveCount(3)

    const hollow = page.getByTestId('candidate').filter({ hasText: 'Hollow.exe' })
    await hollow.getByLabel('Titre').fill('Hollow Knight (DRM-free)')
    await hollow.getByRole('button', { name: 'Importer' }).click()
    await page
      .getByTestId('candidate')
      .filter({ hasText: 'RetroPack.exe' })
      .getByRole('button', { name: 'Ignorer' })
      .click()
    await expect(page.getByTestId('review-count')).toHaveText('À vérifier (2)')

    // Restore the uninstaller, then import everything else.
    await page
      .getByTestId('candidate-excluded')
      .filter({ hasText: 'unins000.exe' })
      .getByRole('button', { name: 'Restaurer' })
      .click()
    await expect(page.getByTestId('review-count')).toHaveText('À vérifier (3)')
    await page.getByRole('button', { name: /^Tout importer/ }).click()

    await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible()
    for (const title of ['Hades', 'Hollow Knight', 'Disco Elysium', 'Hollow Knight (DRM-free)']) {
      await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Retro Pack', exact: true })).toHaveCount(0)
    await expect(page.getByTestId('game-count')).toHaveText('7 jeux')

    // Sidebar lists the sources with counts.
    const sources = page.getByRole('navigation', { name: 'Navigation principale' })
    await expect(sources.getByRole('button', { name: /^Steam/ })).toContainText('2')
    await expect(sources.getByRole('button', { name: /^GOG/ })).toContainText('1')
  })

  test('the introduction can be skipped', async ({ page }) => {
    await page.getByRole('button', { name: 'Passer l’introduction' }).click()
    await expect(page.getByTestId('library-empty')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('library-empty')).toBeVisible()
  })
})

test.describe('rescan', () => {
  test.use({ launcherRoot: LAUNCHER_FIXTURES })

  test('known launcher games are refreshed, not duplicated', async ({ page }) => {
    await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
    await expect(page.getByTestId('auto-count')).toHaveText('4 correspondances automatiques OK')
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await expect(page.getByTestId('game-count')).toHaveText('4 jeux')

    await page.getByRole('button', { name: 'Détecter les jeux' }).click()
    await page.getByTestId('auto-count').click()
    await expect(page.getByText('déjà présent')).toHaveCount(4)
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await expect(page.getByTestId('game-count')).toHaveText('4 jeux')
  })
})
