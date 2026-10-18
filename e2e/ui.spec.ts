import type { Page } from '@playwright/test'
import { expect, NODE_PATH, test } from './fixtures'

const TITLES = ['Celeste', 'Hades', 'Hollow Knight', 'Outer Wilds', 'Tunic']

async function seed(page: Page) {
  await page.evaluate(
    async ({ exe, titles }) => {
      for (const title of titles) {
        await window.shelf.invoke('games:create', { title, executablePath: exe })
      }
    },
    { exe: NODE_PATH, titles: TITLES }
  )
  await page.reload()
  await expect(page.getByTestId('game-count')).toHaveText('5 jeux')
}

const card = (page: Page, title: string) =>
  page
    .getByTestId('game-card')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })

test('filter bar, list layout and keyboard navigation', async ({ page }) => {
  await seed(page)

  await page.keyboard.press('/')
  await expect(page.getByPlaceholder('Filtrer ce qui est affiché…')).toBeFocused()
  await page.keyboard.type('ho')
  await expect(page.getByTestId('game-card')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('game-card')).toHaveCount(5)

  await page.getByRole('radio', { name: 'Liste' }).click()
  await expect(page.getByTestId('game-row')).toHaveCount(5)
  await page.getByRole('radio', { name: 'Grille' }).click()

  // Roving focus: one tab stop, arrows move, Enter opens the detail, Escape comes back.
  await card(page, 'Celeste').getByRole('button', { name: 'Celeste', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(
    card(page, 'Hades').getByRole('button', { name: 'Hades', exact: true })
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Hades' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible()
})

test('command palette searches games, navigates and runs actions', async ({ page }) => {
  await seed(page)
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
  await expect(palette).toBeVisible()

  await page.keyboard.type('owil') // fuzzy: Outer WILds
  await expect(palette.getByRole('option').first()).toContainText('Outer Wilds')
  await expect(palette.getByRole('option').first()).toContainText('↵ Jouer')
  await page.keyboard.press('Tab')
  await expect(palette).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Outer Wilds' })).toBeVisible()

  await page.keyboard.press('Control+k')
  await page.keyboard.type('ajouter')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Ajouter un jeu' })).toBeVisible()
})

test('context menu: favorite, tags, collections, hide', async ({ page }) => {
  await seed(page)

  // New manual collection from the sidebar.
  await page.getByRole('button', { name: '+ nouvelle' }).click()
  await page.getByLabel('Nom de la nouvelle collection').fill('À finir')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'À finir' })).toBeVisible()
  await page.getByRole('button', { name: 'Bibliothèque' }).click()

  await card(page, 'Tunic').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Actions pour Tunic' })
  await menu.getByRole('menuitem', { name: '♥ Favori' }).click()
  await expect(card(page, 'Tunic').getByTestId('favorite-mark')).toBeVisible()

  await card(page, 'Tunic').click({ button: 'right' })
  await menu.getByLabel('Nouveau tag').fill('co-op')
  await menu.getByLabel('Nouveau tag').press('Enter')
  await expect(menu.getByRole('button', { name: 'co-op' })).toHaveAttribute('aria-pressed', 'true')
  await menu.getByRole('menuitemcheckbox', { name: 'À finir' }).click()
  await expect(menu.getByRole('menuitemcheckbox', { name: 'À finir' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await page.keyboard.press('Escape')

  // Tag chip in the sidebar filters the library.
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'co-op' })
    .click()
  await expect(page.getByTestId('game-count')).toHaveText('1 jeu')
  await page
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('button', { name: 'co-op' })
    .click()

  await page.getByTestId('sidebar-collection').filter({ hasText: 'À finir' }).click()
  await expect(page.getByTestId('game-count')).toHaveText('1 jeu')
  await page.getByRole('button', { name: 'Bibliothèque' }).click()

  await card(page, 'Celeste').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Masquer' }).click()
  await expect(page.getByTestId('game-count')).toHaveText('4 jeux')
})

test('smart collection follows its rules; rename and delete', async ({ page }) => {
  await seed(page)
  await card(page, 'Hades').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '♥ Favori' }).click()

  await page.getByRole('button', { name: '+ nouvelle' }).click()
  await page.getByLabel('Nom de la nouvelle collection').fill('Mes favoris')
  await page.keyboard.press('Enter')
  await page.getByRole('radio', { name: 'Intelligente (règles)' }).click()
  await expect(page.getByTestId('rules-editor')).toBeVisible()
  await expect(page.getByTestId('game-count')).toHaveText('5 jeux')
  await page.getByTestId('rules-editor').getByRole('button', { name: 'Favoris ou non' }).click()
  await expect(page.getByTestId('game-count')).toHaveText('1 jeu')

  await page.getByRole('button', { name: 'Renommer' }).click()
  await page.getByLabel('Nom de la collection').fill('Top')
  await page.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByRole('heading', { name: 'Top' })).toBeVisible()

  await page.getByRole('button', { name: 'Supprimer' }).click()
  await page.getByRole('button', { name: 'Confirmer la suppression' }).click()
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible()
  await expect(page.getByTestId('sidebar-collection')).toHaveCount(0)
})

test('detail page tags and appearance settings', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: 'Celeste', exact: true }).click()
  await page.getByRole('button', { name: '+ tag' }).click()
  await page.getByLabel('Nouveau tag').fill('Cosy')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('game-tags')).toContainText('cosy')

  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'Apparence' }).click()
  await page.getByRole('radio', { name: 'Grandes' }).click()
  await expect(page.getByRole('radio', { name: 'Grandes' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Raccourcis' }).click()
  await expect(page.getByText('Palette de commandes')).toBeVisible()
})
