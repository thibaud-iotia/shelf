import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, fetchCalls, NODE_PATH, stubFetch, test, type FetchRoute } from './fixtures'

const api = (name: string): unknown =>
  JSON.parse(readFileSync(resolve('tests/fixtures/api', name), 'utf8'))
const PNG = readFileSync(resolve('tests/fixtures/images/cover.png')).toString('base64')

/** Recorded Steam answers for Hades (appid 1145360); images are a local PNG. */
const STEAM: FetchRoute[] = [
  { match: '/api/storesearch/', body: { total: 0, items: [] } },
  { match: '/api/appdetails', body: api('steam-appdetails.json') },
  {
    match: 'IStoreBrowseService/GetItems',
    // The recorded summary is Portal 2's: same shape, other appid.
    body: JSON.parse(JSON.stringify(api('steam-storebrowse.json')).replace(/620/g, '1145360'))
  },
  { match: 'GetNumberOfCurrentPlayers', body: api('steam-players.json') },
  { match: 'GetNewsForApp', body: api('steam-news.json') },
  { match: 'steamstatic.com', image: PNG },
  { match: 'akamaihd.net', image: PNG }
]

async function openGame(page: Page, title: string, patch: Record<string, unknown> = {}) {
  await page.evaluate(
    async ({ exe, title, patch }) => {
      const created = await window.shelf.invoke('games:create', { title, executablePath: exe })
      if (created.ok && Object.keys(patch).length) {
        await window.shelf.invoke('games:update', created.data.id, patch)
      }
    },
    { exe: NODE_PATH, title, patch }
  )
  await page.reload()
  await page.getByRole('button', { name: title, exact: true }).click()
}

const loads = (page: Page, url: string) =>
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

async function steamUrls(app: ElectronApplication) {
  return (await fetchCalls(app)).filter((u) => !/steamstatic|akamaihd/.test(u))
}

test('game page shows Steam news, videos, reviews and links', async ({ app, page }) => {
  await stubFetch(app, STEAM)
  await openGame(page, 'Hades', { steamAppId: '1145360' })

  // Side card: reviews, players online, Metacritic, links.
  await expect(page.getByTestId('reviews')).toContainText('extrêmement positives')
  await expect(page.getByTestId('reviews')).toContainText('98 %')
  await expect(page.getByTestId('players-online')).toContainText(/1\s664 joueurs en ligne/)
  const links = page.getByTestId('links')
  await expect(links.getByRole('link', { name: 'Site officiel ↗' })).toHaveAttribute(
    'href',
    'https://www.supergiantgames.com/'
  )
  await expect(links.getByRole('link', { name: 'Page Steam ↗' })).toHaveAttribute(
    'href',
    'https://store.steampowered.com/app/1145360/'
  )

  const tabs = page.getByRole('tablist', { name: 'Sections de la fiche' })
  await expect(tabs.getByRole('tab')).toHaveText([
    'Aperçu',
    'Actualités',
    'Vidéos · 3',
    'Communauté',
    'Succès · 49'
  ])

  // Overview: without IGDB, the Steam store page fills it.
  await expect(page.getByTestId('description')).toContainText('Défiez le dieu des morts')
  await expect(page.getByText('· 2020 · Supergiant Games')).toBeVisible()
  const facts = page.getByTestId('store-facts')
  await expect(facts).toContainText('17 sept. 2020')
  await expect(facts).toContainText('Windows · macOS')
  await expect(facts).toContainText('24,50 €')
  await expect(page.getByTestId('features')).toContainText('Steam Cloud')
  await expect(page.getByTestId('about')).toContainText('LUTTEZ POUR ÉCHAPPER AUX ENFERS')
  await expect(page.getByTestId('requirements')).toContainText('Mémoire vive : 8 GB de mémoire')
  await expect(page.getByTestId('languages')).toContainText('Français')
  await expect(page.getByTestId('latest-news').getByRole('listitem')).toHaveCount(3)

  // Gallery: trailer first, then the screenshots; a screenshot opens full screen.
  const gallery = page.getByTestId('media-gallery')
  await expect(gallery.getByRole('button', { name: /^Vidéo : / })).toBeVisible()
  await gallery.getByRole('button', { name: 'Capture 2' }).click()
  await gallery.getByRole('button', { name: 'Agrandir la capture' }).click()
  const lightbox = page.getByTestId('lightbox')
  await expect(lightbox).toHaveAttribute('aria-label', 'Capture 2 sur 4')
  await page.keyboard.press('ArrowRight')
  await expect(lightbox).toHaveAttribute('aria-label', 'Capture 3 sur 4')
  await page.keyboard.press('Escape')
  await expect(lightbox).toHaveCount(0)
  await expect(page.getByTestId('media-gallery')).toBeVisible()

  // News: official announcements flagged, images proxied by the main process.
  await tabs.getByRole('tab', { name: 'Actualités' }).click()
  const news = page.getByTestId('news').getByRole('listitem')
  await expect(news).toHaveCount(4)
  await expect(news.first()).toContainText('Annonce officielle')
  await expect(news.first()).toContainText('Watch the Hades Orchestral Concert')
  await expect(news.first().getByRole('link')).toHaveAttribute('target', '_blank')
  const image = news.first().locator('img')
  await expect(image).toHaveAttribute('src', /^shelf-media:\/\/remote\//)
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(60)
  // The press article's image is on a host Shelf does not proxy: placeholder instead.
  await expect(news.nth(1).locator('img')).toHaveCount(0)

  // Videos: nothing is streamed before a click; then the Steam mp4 trailer plays.
  await tabs.getByRole('tab', { name: 'Vidéos · 3' }).click()
  await expect(page.getByTestId('video-player')).toHaveCount(0)
  await page.getByRole('button', { name: 'Lire « Hades - v1.0 Launch Trailer »' }).click()
  await expect(page.getByTestId('video-player').locator('source').first()).toHaveAttribute(
    'src',
    'https://video.akamai.steamstatic.com/store_trailers/256801252/movie_max.mp4'
  )
  await page.getByRole('button', { name: 'Hades - v1.0 Gameplay Showcase' }).click()
  await expect(page.getByRole('button', { name: /Lire « Hades - v1.0 Gameplay/ })).toBeVisible()

  // Community and achievements need a Steam account key.
  await tabs.getByRole('tab', { name: 'Communauté' }).click()
  await expect(page.getByTestId('panel-error')).toContainText('Connectez un compte Steam')
  await tabs.getByRole('tab', { name: 'Succès · 49' }).click()
  await expect(page.getByTestId('panel-error')).toContainText('Connectez un compte Steam')

  // Back on the overview, the usual content is there.
  await tabs.getByRole('tab', { name: 'Aperçu' }).click()
  await expect(page.getByTestId('playtime')).toBeVisible()

  // Every request went to Steam through the stub; the store search was not needed.
  const urls = await steamUrls(app)
  expect(urls.every((u) => /^https:\/\/(api|store)\.steampowered\.com\//.test(u))).toBe(true)
  expect(urls.some((u) => u.includes('storesearch'))).toBe(false)
})

test('remote image proxy only serves allowed CDNs', async ({ app, page }) => {
  await stubFetch(app, [{ match: 'https://', image: PNG }])
  const proxy = (url: string) => `shelf-media://remote/${Buffer.from(url).toString('base64url')}`
  expect(await loads(page, proxy('https://cdn.akamai.steamstatic.com/a.png'))).toBe(true)
  expect(await loads(page, proxy('https://evil.example.com/a.png'))).toBe(false)
  expect(await loads(page, 'shelf-media://remote/not*base64')).toBe(false)
  expect(await fetchCalls(app)).toEqual(['https://cdn.akamai.steamstatic.com/a.png'])
})

test('a game without Steam page keeps the plain page; its AppID can be set', async ({
  app,
  page
}) => {
  await stubFetch(app, STEAM)
  await openGame(page, 'Jeu Inconnu')
  await expect(page.getByTestId('playtime')).toBeVisible()
  await expect.poll(async () => (await steamUrls(app)).length).toBeGreaterThan(0)
  await expect(page.getByRole('tablist')).toHaveCount(0)
  expect((await steamUrls(app))[0]).toContain('storesearch/?term=Jeu+Inconnu')

  await page.getByRole('button', { name: 'Modifier' }).click()
  const appId = page.getByLabel('AppID Steam')
  await appId.fill('pas un nombre')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // Shown in the form (and as a toast, like every failed save).
  await expect(
    page.locator('p[role="alert"]').filter({ hasText: 'AppID Steam attendu : un nombre' })
  ).toBeVisible()
  await appId.fill('1145360')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect(page.getByRole('tab', { name: 'Actualités' })).toBeVisible()
  await expect(page.getByTestId('reviews')).toContainText('extrêmement positives')
})

test('offline: the game page still opens, extras stay hidden', async ({ page }) => {
  await openGame(page, 'Hors Ligne', { steamAppId: '1145360' })
  await expect(page.getByTestId('playtime')).toBeVisible()
  // The Steam page is known, so the tabs are there; their content explains the failure.
  await page.getByRole('tab', { name: 'Actualités' }).click()
  await expect(page.getByTestId('panel-error')).toContainText('Impossible de joindre Steam')
  await expect(page.getByTestId('reviews')).toHaveCount(0)
})
