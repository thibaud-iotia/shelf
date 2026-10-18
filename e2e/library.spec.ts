import { join } from 'node:path'
import { expect, FAKE_GAME_SCRIPT, NODE_PATH, stubOpenDialog, test } from './fixtures'

test('adds a game manually, launches it and records the session', async ({ app, page }) => {
  await page.getByRole('button', { name: '+ Ajouter un jeu' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un jeu' })

  await stubOpenDialog(app, NODE_PATH)
  await dialog.getByRole('button', { name: 'Parcourir…' }).click()
  await expect(dialog.getByLabel('Exécutable')).toHaveValue(NODE_PATH)
  await expect(dialog.getByLabel('Titre')).not.toHaveValue('')

  await dialog.getByLabel('Titre').fill('Fake Quest')
  await dialog.getByLabel('Arguments de lancement').fill(`"${FAKE_GAME_SCRIPT}" 1500`)
  await dialog.getByRole('button', { name: 'Ajouter' }).click()
  await expect(dialog).toBeHidden()

  const card = page.getByTestId('game-card').filter({ hasText: 'Fake Quest' })
  await expect(card).toBeVisible()
  await expect(page.getByTestId('game-count')).toHaveText('1 jeu')

  await card.getByRole('button', { name: 'Fake Quest', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Fake Quest' })).toBeVisible()
  await expect(page.getByTestId('last-session')).toHaveText('Jamais')

  await page.getByRole('button', { name: '▶ Jouer' }).click()
  await expect(page.getByRole('button', { name: '● En cours…' })).toBeDisabled()
  await expect(page.getByTestId('running-list')).toContainText('Fake Quest')

  // The fake game exits after 1.5 s: the session is closed and shown.
  await expect(page.getByRole('button', { name: '▶ Jouer' })).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByTestId('running-list')).toBeHidden()
  await expect(page.getByTestId('last-session')).toHaveText(/^Aujourd’hui, /)
  await expect(page.getByTestId('sessions').getByRole('listitem')).toHaveCount(1)
})

test('edits and deletes a game', async ({ page }) => {
  await page.evaluate(
    (exe) => window.shelf.invoke('games:create', { title: 'Old Title', executablePath: exe }),
    NODE_PATH
  )
  await page.reload()
  await page.getByRole('button', { name: 'Old Title', exact: true }).click()

  await page.getByRole('button', { name: 'Modifier' }).click()
  const dialog = page.getByRole('dialog', { name: 'Modifier le jeu' })
  await dialog.getByLabel('Titre').fill('New Title')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'New Title' })).toBeVisible()

  await page.getByRole('button', { name: 'Ajouter aux favoris' }).click()
  await expect(page.getByRole('button', { name: 'Retirer des favoris' })).toBeVisible()

  await page.getByRole('button', { name: 'Modifier' }).click()
  await dialog.getByRole('button', { name: 'Supprimer' }).click()
  await dialog.getByRole('button', { name: 'Confirmer la suppression' }).click()
  await expect(page.getByTestId('library-empty')).toBeVisible()
})

test('shows a clear error for a missing executable', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: '+ Ajouter un jeu' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un jeu' })
  await dialog.getByLabel('Exécutable').fill(join(userDataDir, 'missing.exe'))
  await dialog.getByLabel('Titre').fill('Ghost')
  await dialog.getByRole('button', { name: 'Ajouter' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Exécutable introuvable')
})
