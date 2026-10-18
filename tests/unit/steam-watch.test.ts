import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SteamWatcher } from '../../src/main/launch/steam-watch'
import { parseRegQuery } from '../../src/main/platform/registry'
import {
  parseAppId,
  readRunningAppIdFromVdf,
  runningAppIdFromVdf
} from '../../src/main/sources/steam-running'
import { tempDir } from './helpers'

const REGISTRY_VDF = `"Registry"
{
  "HKCU"
  {
    "Software"
    {
      "Valve"
      {
        "Steam"
        {
          "language"    "french"
          "RunningAppID"    "1145360"
        }
      }
    }
  }
}`

describe('Steam RunningAppID', () => {
  it('reads reg query DWORDs and decimal values', () => {
    const out =
      'HKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x117a10\r\n'
    expect(parseAppId(parseRegQuery(out)[0]?.values.runningappid)).toBe(1145360)
    expect(parseAppId('0x0')).toBe(0)
    expect(parseAppId('620')).toBe(620)
    expect(parseAppId('nope')).toBeNull()
    expect(parseAppId(undefined)).toBeNull()
  })

  it('reads registry.vdf (Linux, macOS)', async () => {
    expect(runningAppIdFromVdf(REGISTRY_VDF)).toBe(1145360)
    expect(runningAppIdFromVdf('"Registry" { }')).toBeNull()

    const dir = tempDir()
    writeFileSync(join(dir, 'registry.vdf'), REGISTRY_VDF.replace('1145360', '0'))
    expect(
      await readRunningAppIdFromVdf([join(dir, 'missing.vdf'), join(dir, 'registry.vdf')])
    ).toBe(0)
    expect(await readRunningAppIdFromVdf([join(dir, 'missing.vdf')])).toBeNull()
  })
})

describe('SteamWatcher', () => {
  let watcher: SteamWatcher | undefined
  afterEach(() => watcher?.dispose())

  function setup(startTimeoutMs = 60_000) {
    const state = { running: 0 as number | null, now: 0 }
    const events: string[] = []
    watcher = new SteamWatcher({
      readRunningAppId: async () => state.running,
      pollMs: 3_600_000, // polled by hand
      startTimeoutMs,
      now: () => state.now
    })
    watcher.on('change', (ids) => events.push(`change:${ids.join(',')}`))
    watcher.on('ended', (id) => events.push(`ended:${id}`))
    return { state, events, watcher }
  }

  it('follows a Steam game from start to end', async () => {
    const { state, events, watcher } = setup()
    watcher.watch(7, 1145360)
    await watcher.poll() // Steam still starting the game
    expect(watcher.runningIds()).toEqual([])

    state.running = 1145360
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([7])

    state.running = null // unreadable for a moment: not an end
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([7])

    state.running = 0
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([])
    expect(events).toEqual(['change:7', 'change:', 'ended:7'])
  })

  it('gives up when the game never starts', async () => {
    const { state, events, watcher } = setup(1_000)
    watcher.watch(7, 620)
    state.now = 2_000
    await watcher.poll()
    state.running = 620
    await watcher.poll()
    expect(events).toEqual([])
  })

  it('ignores invalid app ids', async () => {
    const { state, events, watcher } = setup()
    watcher.watch(7, Number('abc'))
    state.running = 0
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([])
    expect(events).toEqual([])
  })
})
