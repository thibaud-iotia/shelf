import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  expect,
  fetchCalls,
  LAUNCHER_FIXTURES,
  NODE_PATH,
  stubFetch,
  test,
  type FetchRoute
} from './fixtures'

const api = (name: string): unknown =>
  JSON.parse(readFileSync(resolve('tests/fixtures/api', name), 'utf8'))
const PNG = readFileSync(resolve('tests/fixtures/images/cover.png')).toString('base64')

/** Hades sold on Steam and, cheaper, on the Epic Games Store. */
const HADES_SHEET = {
  info: { title: 'Hades', steamAppID: '1145360' },
  cheapestPriceEver: { price: '6.24', date: 1758129350 },
  deals: [
    { storeID: '1', dealID: 'steamdeal%3D', price: '24.99', retailPrice: '24.99', savings: '0' },
    { storeID: '25', dealID: 'epicdeal%3D', price: '19.99', retailPrice: '24.99', savings: '20' }
  ]
}

/** Recorded CheapShark and Steam answers; images are a local PNG. */
const STORE: FetchRoute[] = [
  { match: 'cheapshark.com/api/1.0/stores', body: api('cheapshark-stores.json') },
  { match: 'cheapshark.com/api/1.0/deals?steamAppID', body: api('cheapshark-deals-steam.json') },
  { match: 'cheapshark.com/api/1.0/deals?', body: api('cheapshark-deals.json') },
  { match: 'cheapshark.com/api/1.0/games?title=', body: api('cheapshark-search.json') },
  { match: 'cheapshark.com/api/1.0/games?ids=', body: { '196149': HADES_SHEET } },
  { match: 'cheapshark.com/api/1.0/games?id=', body: HADES_SHEET },
  { match: 'IStoreBrowseService/GetItems', body: api('steam-store-items.json') },
  // Store page of Hades: same Steam blocks as a library game page.
  { match: '/api/appdetails', body: api('steam-appdetails.json') },
  { match: 'GetNumberOfCurrentPlayers', body: api('steam-players.json') },
  { match: 'GetNewsForApp', body: api('steam-news.json') },
  { match: 'steamstatic.com', image: PNG },
  { match: 'epicgames.com', image: PNG }
]

async function captureOpened(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => {
      opened.push(url)
    }
  })
}

const opened = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { opened?: string[] }).opened)

async function openStore(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Boutique' }).click()
  await expect(page.getByRole('heading', { name: 'Boutique' })).toBeVisible()
}

test('store: home, wishlist, search and a purchase detected on return', async ({ app, page }) => {
  await stubFetch(app, STORE)
  await captureOpened(app)
  await openStore(page)

  // Home: featured deals, an invitation to fill the wishlist, the current deals.
  const featured = page.getByTestId('store-featured')
  await expect(featured).toContainText('À LA UNE')
  await expect(featured.getByRole('heading', { level: 2 })).toHaveText('Flotsam')
  await featured.getByRole('button', { name: 'À la une : Hitman 2: Silent Assassin' }).click()
  await expect(featured).toContainText('-90%')
  await expect(page.getByTestId('home-wishlist')).toContainText('Ajoutez des jeux avec ♡')
  await expect(page.getByTestId('home-free')).toContainText('Flotsam')
  const homeDeals = page.getByTestId('home-deals').getByTestId('store-card')
  await expect(homeDeals).toHaveCount(6)
  const metro = homeDeals.filter({ hasText: 'Metro Exodus' })
  await metro.getByTestId('wish-toggle').click()
  await expect(metro.getByTestId('wish-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('home-wishlist').getByTestId('store-card')).toHaveCount(1)

  // Wishlist and deals tabs.
  const cards = page.getByTestId('store-card')
  await page.getByRole('tab', { name: /Liste de souhaits/ }).click()
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText('Metro Exodus')
  await page.getByRole('tab', { name: 'Promotions' }).click()
  await expect(cards).toHaveCount(11)

  // Search, then the store page of Hades: laid out like a game page, "Acheter" instead of "Jouer".
  await page.getByRole('textbox', { name: 'Rechercher un jeu à acheter' }).fill('hades')
  await expect(page.getByText('Résultats pour « hades »')).toBeVisible()
  await expect(cards).toHaveCount(5)
  await cards
    .filter({ hasText: /^Hades/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Hades', level: 1 })).toBeVisible()
  await expect(page.getByTestId('breadcrumb-title')).toHaveText('Hades')
  await expect(page.getByTestId('description')).toContainText('dieu des morts')
  await expect(
    page.getByRole('tablist', { name: 'Sections de la fiche' }).getByRole('tab')
  ).toHaveText(['Aperçu', 'Actualités', 'Vidéos · 3'])
  const offers = page.getByTestId('store-offer')
  await expect(offers).toHaveCount(2)
  // Cheapest first; Steam shows its price in euros.
  await expect(offers.first()).toHaveAttribute('data-store', 'Epic Games Store')
  await expect(offers.first()).toContainText('-20%')
  await expect(offers.nth(1)).toContainText('24,50 €')
  await expect(page.getByTestId('lowest-ever')).toContainText('Plus bas historique : 6,24 $')

  // No launcher installed: the best offer (Epic) and Steam open in the browser.
  await page.getByRole('button', { name: /^Acheter · 19,99 \$/ }).click()
  await expect(page.getByText('Page du magasin ouverte dans le navigateur')).toBeVisible()
  await expect(offers.nth(1)).toContainText('dans le navigateur')
  await offers.nth(1).getByRole('button', { name: 'Acheter' }).click()
  await expect
    .poll(() => opened(app))
    .toEqual([
      'https://www.cheapshark.com/redirect?dealID=epicdeal%3D',
      'https://store.steampowered.com/app/1145360/'
    ])

  // Bought: the game shows up (here added by hand), Shelf notices when it gets the focus back.
  await page.evaluate(
    (exe) => window.shelf.invoke('games:create', { title: 'Hades', executablePath: exe }),
    NODE_PATH
  )
  await app.evaluate(({ app }) => {
    app.emit('browser-window-focus')
  })
  await expect(
    page.getByText('Achat détecté : « Hades » est dans votre bibliothèque.')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Dans votre bibliothèque →' }).click()
  await expect(page.getByRole('button', { name: '▶ Jouer' })).toBeVisible()

  // Back twice: the store page, then the search results, as they were left.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lowest-ever')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Résultats pour « hades »')).toBeVisible()

  // Only the store services were called (plus Steam's store and CDN for the game page).
  for (const url of await fetchCalls(app)) {
    expect(new URL(url).hostname).toMatch(
      /^(www\.cheapshark\.com|api\.steampowered\.com|store\.steampowered\.com|\w+\.\w+\.steamstatic\.com|cdn1\.epicgames\.com)$/
    )
  }
})

test.describe('with Steam installed', () => {
  test.use({ launcherRoot: LAUNCHER_FIXTURES })

  test('"Acheter" opens the Steam store page in the Steam client', async ({ app, page }) => {
    await stubFetch(app, STORE)
    await captureOpened(app)
    await openStore(page)
    await page.getByRole('textbox', { name: 'Rechercher un jeu à acheter' }).fill('hades')
    await page
      .getByTestId('store-card')
      .filter({ hasText: /^Hades/ })
      .first()
      .click()
    const steam = page.getByTestId('store-offer').nth(1)
    await expect(steam).toContainText('dans Steam')
    await steam.getByRole('button', { name: 'Acheter' }).click()
    await expect(page.getByText('Page du jeu ouverte dans Steam')).toBeVisible()
    await expect.poll(() => opened(app)).toEqual(['steam://store/1145360'])
  })
})

// First visit performance: every store request takes LATENCY_MS, so a page that waited for
// the network could not show up within that time.
const LATENCY_MS = 1500
const SLOW_STORE: FetchRoute[] = STORE.map((route) => ({ ...route, delayMs: LATENCY_MS }))
const apiCalls = async (app: ElectronApplication) =>
  (await fetchCalls(app)).filter((url) => !/steamstatic|epicgames/.test(url))

test.describe('first visit, store warmed up at startup', () => {
  test.use({ storePrewarmMs: 500, launchFetch: { routes: SLOW_STORE } })

  test('the home shows up at once, without waiting for the network', async ({ app, page }) => {
    // Warm-up: deals, then the first images of the home, in the background.
    await expect
      .poll(async () => (await fetchCalls(app)).filter((u) => u.includes('steamstatic')).length, {
        timeout: 15_000
      })
      .toBeGreaterThan(5)
    // Lets the images still in flight (4 at a time) land.
    await page.waitForTimeout(LATENCY_MS + 500)
    const before = await apiCalls(app)
    expect(before.some((url) => url.includes('/deals?'))).toBe(true)

    const start = Date.now()
    await openStore(page)
    const featured = page.getByTestId('store-featured')
    await expect(featured.getByRole('heading', { level: 2 })).toHaveText('Flotsam')
    await expect(page.getByTestId('home-deals').getByTestId('store-card')).toHaveCount(6)
    // The banner's artwork is already downloaded too.
    await expect
      .poll(() =>
        featured
          .locator('button img')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
      )
      .toBe(true)
    expect(Date.now() - start).toBeLessThan(LATENCY_MS)
    // Served from the caches: no new request to the store services.
    expect(await apiCalls(app)).toEqual(before)
  })
})

test('hovering "Boutique" starts loading the home before the click', async ({ app, page }) => {
  await stubFetch(app, STORE)
  await page.getByRole('navigation').getByRole('button', { name: 'Boutique' }).hover()
  await expect
    .poll(async () => (await apiCalls(app)).some((url) => url.includes('/deals?')))
    .toBe(true)
  await openStore(page)
  await expect(page.getByTestId('store-featured').getByRole('heading', { level: 2 })).toHaveText(
    'Flotsam'
  )
})
