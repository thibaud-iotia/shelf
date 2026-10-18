import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, NODE_PATH, stubOpenDialog, test } from './fixtures'

const COVER = resolve('tests/fixtures/images/cover.png')

test('API keys are stored encrypted and never shown back', async ({ page, userDataDir }) => {
  await page.getByRole('button', { name: 'Réglages' }).click()
  // Mockup 08: the settings open on "Métadonnées".
  await expect(page.getByRole('heading', { name: 'Métadonnées et images' })).toBeVisible()
  const igdb = page.getByTestId('keys-igdb')
  await expect(page.getByTestId('keys-igdb-status')).toHaveText('non configuré')

  await igdb.getByLabel('Client ID').fill('my-client-id-123')
  await igdb.getByLabel('Secret').fill('my-very-secret-value')
  await igdb.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByTestId('keys-igdb-status')).toHaveText('✓ configuré')
  await expect(igdb.getByLabel('Secret')).toHaveValue('')
  await expect(
    page.getByText('Clés chiffrées par le système, jamais affichées en clair')
  ).toBeVisible()

  const vault = readFileSync(join(userDataDir, 'secrets.json'), 'utf8')
  expect(vault).toContain('igdb.clientSecret')
  expect(vault).not.toContain('my-very-secret-value')
  const db = readFileSync(join(userDataDir, 'shelf.db'))
  expect(db.includes(Buffer.from('my-very-secret-value'))).toBe(false)

  // Survives a restart of the renderer.
  await page.reload()
  await page.getByRole('button', { name: 'Réglages' }).click()
  await expect(page.getByTestId('keys-igdb-status')).toHaveText('✓ configuré')
  await page.getByTestId('keys-igdb').getByRole('button', { name: 'Oublier' }).click()
  await expect(page.getByTestId('keys-igdb-status')).toHaveText('non configuré')
})

test('custom cover is cached and served through shelf-media://', async ({ app, page }) => {
  await page.evaluate(
    (exe) => window.shelf.invoke('games:create', { title: 'Cover Test', executablePath: exe }),
    NODE_PATH
  )
  await page.reload()
  await page.getByRole('button', { name: 'Cover Test', exact: true }).click()

  await stubOpenDialog(app, COVER)
  await page.getByRole('button', { name: 'Changer la jaquette…' }).click()
  await page.getByRole('button', { name: '← Bibliothèque' }).click()

  const img = page.getByTestId('game-card').filter({ hasText: 'Cover Test' }).locator('img')
  await expect(img).toHaveAttribute('src', /^shelf-media:\/\/covers\//)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(60)

  // Anything outside the covers folder is refused by the protocol.
  const loads = (url: string) =>
    page.evaluate(
      (src) =>
        new Promise<boolean>((done) => {
          const probe = new Image()
          probe.onload = () => done(true)
          probe.onerror = () => done(false)
          probe.src = src
        }),
      url
    )
  expect(await loads(await img.getAttribute('src').then(String))).toBe(true)
  expect(await loads('shelf-media://covers/..%2Fshelf.db')).toBe(false)
  expect(await loads('shelf-media://other/x.png')).toBe(false)

  await page.getByRole('button', { name: 'Réglages' }).click()
  await page.getByRole('button', { name: 'Cache' }).click()
  await expect(page.getByText('1 fichier')).toBeVisible()
  await page.getByRole('button', { name: 'Vider le cache' }).click()
  await page.getByRole('button', { name: 'Confirmer : vider le cache' }).click()
  await expect(page.getByText('0 o')).toBeVisible()
  await page.getByRole('button', { name: 'Bibliothèque' }).click()
  await expect(img).toHaveCount(0)
})
