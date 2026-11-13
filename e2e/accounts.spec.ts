import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, LAUNCHER_FIXTURES, stubOpenDialog, test } from './fixtures'

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
    const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened)

    // Background install off: Steam's own install dialog.
    await page.evaluate(() => window.shelf.invoke('settings:update', { backgroundInstall: false }))
    await page.getByRole('button', { name: 'Installer' }).click()
    await expect.poll(opened).toEqual(['steam://install/1145360'])
  })

  test('install in the background through Steam’s manifest, followed to the end', async ({
    app,
    page
  }) => {
    // The previous test removed it.
    const manifest = join(root, 'steam', 'steamapps', 'appmanifest_1145360.acf')
    const original = readFileSync(
      join(LAUNCHER_FIXTURES, 'steam', 'steamapps', 'appmanifest_1145360.acf'),
      'utf8'
    )
    writeFileSync(manifest, original)
    await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
    await page.getByRole('button', { name: /^Tout importer/ }).click()
    await expect(page.getByTestId('game-count')).toHaveText('4 jeux')
    rmSync(manifest)
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
    // Where to install: Steam's libraries (the fixture has one on a disk that is there).
    await page.getByRole('button', { name: 'Installer' }).click()
    const dialog = page.getByRole('dialog', { name: 'Installer « Hades »' })
    await expect(dialog.getByRole('radio')).toHaveCount(1)
    await expect(dialog.getByRole('radio')).toBeChecked()
    await expect(dialog).toContainText(join(root, 'steam'))
    await expect(dialog).toContainText(/libres/)
    // A folder inside the library: the game goes in that library, as Steam would do.
    await stubOpenDialog(app, join(root, 'steam', 'steamapps', 'common'))
    await dialog.getByRole('button', { name: 'Autre dossier…' }).click()
    await expect(dialog.getByRole('status')).toContainText('fait partie de la bibliothèque Steam')
    await dialog.getByLabel('Toujours installer ici, sans demander').check()
    await dialog.getByRole('button', { name: 'Installer' }).click()
    await expect(page.getByText('Installation lancée en arrière-plan')).toBeVisible()
    await expect(dialog).toHaveCount(0)

    // Shelf queued the install in Steam's library and started Steam (no window of its own).
    const status = page.getByTestId('install-status')
    await expect(status).toHaveAttribute('data-phase', 'queued')
    await expect(status).toContainText('En file dans Steam')
    expect(readFileSync(manifest, 'utf8')).toMatch(/"StateFlags"\s+"1026"/)
    await expect
      .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
      .toEqual(['steam://open/downloads'])

    // Steam downloads: the progress comes from the manifest.
    writeFileSync(
      manifest,
      readFileSync(manifest, 'utf8')
        .replace(/"BytesToDownload"\s+"0"/, '"BytesToDownload" "4294967296"')
        .replace(/"BytesDownloaded"\s+"0"/, '"BytesDownloaded" "1073741824"')
    )
    await expect(status).toContainText('Téléchargement 25 %')
    await expect(status).toContainText('1,0 Go / 4,0 Go')
    await page.getByRole('button', { name: 'Retour : Bibliothèque' }).click()
    await expect(page.getByTestId('install-badge')).toHaveText(/25 %/)
    await page.getByRole('button', { name: 'Hades', exact: true }).click()

    // Done: the library is re-read, the game can be played.
    writeFileSync(manifest, original)
    await expect(page.getByText('« Hades » est installé.')).toBeVisible()
    await expect(page.getByRole('button', { name: '▶ Jouer' })).toBeVisible()
    await expect(page.getByTestId('install-status')).toHaveCount(0)

    // "Toujours installer ici": the default library in the settings, no more asking.
    await page.getByRole('button', { name: 'Réglages' }).click()
    await page.getByRole('button', { name: 'Système' }).click()
    await expect(page.getByTestId('install-path-steam')).toContainText(join(root, 'steam'))
    await expect(
      page.getByRole('switch', { name: 'Demander l’emplacement à chaque installation' })
    ).not.toBeChecked()
    await page
      .getByTestId('install-path-steam')
      .getByRole('button', { name: 'Automatique' })
      .click()
    await expect(page.getByTestId('install-path-steam')).toContainText('plus d’espace libre')
  })
})

test.describe('GOG Galaxy add-ons', () => {
  // A Galaxy database where The Witcher 3 comes with two add-ons and a hidden edition.
  const root = mkdtempSync(join(tmpdir(), 'shelf-galaxy-'))
  mkdirSync(join(root, 'galaxy'))
  const db = new Database(join(root, 'galaxy', 'galaxy-2.0.db'))
  db.exec(`
    CREATE TABLE LibraryReleases (releaseKey TEXT, userId INTEGER);
    CREATE TABLE GamePieceTypes (id INTEGER PRIMARY KEY, type TEXT);
    CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INTEGER, value TEXT);
    CREATE TABLE ReleaseProperties (releaseKey TEXT, isDlc INTEGER, isVisibleInLibrary INTEGER);
    INSERT INTO GamePieceTypes VALUES (1, 'title'), (2, 'dlcs');
    INSERT INTO LibraryReleases VALUES ('gog_1', 1), ('gog_10', 1), ('gog_11', 1), ('gog_2', 1);
    INSERT INTO GamePieces VALUES
      ('gog_1', 1, 1, '{"title":"The Witcher 3: Wild Hunt"}'),
      ('gog_1', 2, 1, '{"dlcs":["gog_10","gog_11"]}'),
      ('gog_10', 1, 1, '{"title":"Alternative Look for Ciri"}'),
      ('gog_11', 1, 1, '{"title":"Hearts of Stone"}'),
      ('gog_2', 1, 1, '{"title":"The Witcher 3: Wild Hunt"}');
    INSERT INTO ReleaseProperties VALUES ('gog_1', 0, 1), ('gog_10', 1, 1), ('gog_11', 1, 1), ('gog_2', 0, 0);
  `)
  db.close()
  test.use({ launcherRoot: root })
  test.afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('are shown on their game page, not listed as games', async ({ page }) => {
    await page.getByRole('button', { name: 'Réglages' }).click()
    await page.getByRole('button', { name: 'Comptes' }).click()
    await page
      .getByTestId('provider-gog-galaxy')
      .getByRole('button', { name: 'Lire la bibliothèque GOG Galaxy' })
      .click()
    await expect(page.getByTestId('provider-gog-galaxy')).toContainText('GOG Galaxy (local)')

    await page.getByRole('button', { name: 'Bibliothèque' }).click()
    await expect(page.getByTestId('game-count')).toHaveText('1 jeu')
    await expect(page.getByRole('button', { name: 'Alternative Look for Ciri' })).toHaveCount(0)

    await page.getByRole('button', { name: 'The Witcher 3: Wild Hunt', exact: true }).click()
    await expect(page.getByText('CONTENUS ADDITIONNELS · 2')).toBeVisible()
    await expect(page.getByTestId('dlcs').getByRole('listitem')).toHaveText([
      'Alternative Look for Ciri',
      'Hearts of Stone'
    ])
  })
})
