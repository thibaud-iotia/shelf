import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, LAUNCHER_FIXTURES, test } from './fixtures'

// A writable copy of the fake launchers: the test plays Steam by rewriting its registry.vdf.
const launcherRoot = mkdtempSync(join(tmpdir(), 'shelf-launch-'))
cpSync(LAUNCHER_FIXTURES, launcherRoot, { recursive: true })

function writeSteamState(state: { running: number; pid: number; updating?: boolean }) {
  writeFileSync(
    join(launcherRoot, 'steam', 'registry.vdf'),
    `"Registry"
{
  "HKCU"
  {
    "Software"
    {
      "Valve"
      {
        "Steam"
        {
          "RunningAppID"    "${state.running}"
          "ActiveProcess"
          {
            "pid"    "${state.pid}"
          }
          "Apps"
          {
            "1145360"
            {
              "Updating"    "${state.updating ? 1 : 0}"
            }
          }
        }
      }
    }
  }
}`
  )
}

test.use({ launcherRoot })

test.beforeEach(async ({ app, page }) => {
  writeSteamState({ running: 0, pid: 0 }) // Steam closed
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
  await page.getByRole('button', { name: 'Détecter mes jeux' }).click()
  await page.getByRole('button', { name: /^Tout importer/ }).click()
})

test('shows where a Steam launch stands until the game runs', async ({ app, page }) => {
  await page.getByRole('button', { name: 'Hades', exact: true }).click()
  await page.getByRole('button', { name: '▶ Jouer' }).click()

  // Steam was closed: it starts in the tray first, nothing on screen but Shelf's status.
  const status = page.getByTestId('launch-status')
  await expect(status).toContainText('Démarrage de Steam…')
  await expect(status).toBeDisabled()
  await expect(status).toContainText(/\d+ s/)
  await expect(page.getByTestId('launching-entry')).toContainText('Hades')
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['steam://rungameid/1145360'])

  // Steam is up (any live pid will do) and updates the game, then starts it.
  writeSteamState({ running: 0, pid: process.pid, updating: true })
  await expect(status).toContainText('Steam met à jour le jeu…')
  writeSteamState({ running: 0, pid: process.pid })
  await expect(status).toContainText('Steam lance le jeu…')

  writeSteamState({ running: 1145360, pid: process.pid })
  await expect(page.getByRole('button', { name: '● En cours…' })).toBeDisabled()
  await expect(status).toBeHidden()
  await expect(page.getByTestId('launching-entry')).toBeHidden()
  await expect(page.getByTestId('running-list')).toContainText('Hades')

  writeSteamState({ running: 0, pid: process.pid })
  await expect(page.getByRole('button', { name: '▶ Jouer' })).toBeEnabled({ timeout: 15_000 })
})

test('shows the hand-off to Epic on the cover, and can stop waiting', async ({ page }) => {
  const card = page.getByTestId('game-card').filter({ hasText: 'Celeste' })
  await card.getByRole('button', { name: 'Jouer à Celeste' }).click()
  const badge = card.getByTestId('launch-badge')
  await expect(badge).toHaveText('Ouverture…')
  await expect(badge).toHaveAttribute('title', 'Ouverture d’Epic Games…')
  await expect(card.getByRole('button', { name: 'Jouer à Celeste' })).toHaveCount(0)
  await expect(page.getByTestId('launching-entry')).toContainText('Celeste')

  await page.getByTestId('launching-entry').click()
  await expect(page.getByTestId('launch-status')).toContainText('Ouverture d’Epic Games…')
  await page.getByRole('button', { name: 'Ne plus attendre le lancement' }).click()
  await expect(page.getByRole('button', { name: '▶ Jouer' })).toBeEnabled()
  await expect(page.getByTestId('running-list')).toBeHidden()
})
