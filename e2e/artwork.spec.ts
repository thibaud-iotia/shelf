import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, NODE_PATH, stubFetch, test } from './fixtures'

test('SteamGridDB artwork is stored at its display size, not as downloaded', async ({
  app,
  page,
  userDataDir
}) => {
  // Full-size originals as SteamGridDB serves them. Random pixels: PNG cannot compress
  // them, like real artwork. The logo is half transparent.
  const originals = await app.evaluate(({ nativeImage }) => {
    const make = (width: number, height: number, transparent: boolean) => {
      const bitmap = Buffer.alloc(width * height * 4)
      for (let i = 0; i < bitmap.length; i += 4) {
        bitmap[i] = Math.random() * 256
        bitmap[i + 1] = Math.random() * 256
        bitmap[i + 2] = Math.random() * 256
        bitmap[i + 3] = transparent && (i / 4) % 2 ? 0 : 255
      }
      return nativeImage.createFromBitmap(bitmap, { width, height }).toPNG().toString('base64')
    }
    return {
      cover: make(1200, 1800, false),
      hero: make(2400, 800, false),
      logo: make(1600, 800, true)
    }
  })
  const image = (url: string) => ({ success: true, data: [{ id: 1, url }] })
  await stubFetch(app, [
    { match: '/search/autocomplete/', body: { success: true, data: [{ id: 42, name: 'Noise' }] } },
    { match: '/grids/game/42', body: image('https://cdn2.steamgriddb.com/grid/cover.png') },
    { match: '/heroes/game/42', body: image('https://cdn2.steamgriddb.com/hero/hero.png') },
    { match: '/logos/game/42', body: image('https://cdn2.steamgriddb.com/logo/logo.png') },
    { match: 'cdn2.steamgriddb.com/grid/', image: originals.cover },
    { match: 'cdn2.steamgriddb.com/hero/', image: originals.hero },
    { match: 'cdn2.steamgriddb.com/logo/', image: originals.logo }
  ])

  const gameId = await page.evaluate(async (exe) => {
    const created = await window.shelf.invoke('games:create', {
      title: 'Noise',
      executablePath: exe
    })
    if (!created.ok) throw new Error(created.error.message)
    await window.shelf.invoke('keys:set', { steamGridDbKey: 'k' })
    const applied = await window.shelf.invoke('metadata:refreshArtwork', created.data.id)
    if (!applied.ok) throw new Error(applied.error.message)
    return created.data.id
  }, NODE_PATH)

  const dir = join(userDataDir, 'covers')
  const file = (kind: string) => {
    const name = readdirSync(dir).find((f) => f.startsWith(`${gameId}-${kind}-`))
    if (!name) throw new Error(`no ${kind} file`)
    return join(dir, name)
  }
  const sizeOf = (path: string) =>
    app.evaluate(({ nativeImage }, p) => nativeImage.createFromPath(p).getSize(), path)
  const bytes = (kind: keyof typeof originals) => Buffer.from(originals[kind], 'base64').length

  // Cover: the 600×900 box of the grid, JPEG.
  expect(file('cover')).toMatch(/\.jpg$/)
  expect(await sizeOf(file('cover'))).toEqual({ width: 600, height: 900 })
  expect(statSync(file('cover')).size).toBeLessThan(bytes('cover') / 4)

  // Hero: full HD width, JPEG.
  expect(file('hero')).toMatch(/\.jpg$/)
  expect(await sizeOf(file('hero'))).toEqual({ width: 1920, height: 640 })
  expect(statSync(file('hero')).size).toBeLessThan(bytes('hero') / 2)

  // Logo: transparency kept (PNG), 800×400 box.
  expect(file('logo')).toMatch(/\.png$/)
  expect(await sizeOf(file('logo'))).toEqual({ width: 800, height: 400 })
  expect(statSync(file('logo')).size).toBeLessThan(bytes('logo'))
})
