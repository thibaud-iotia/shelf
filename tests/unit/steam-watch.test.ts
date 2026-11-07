import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SteamWatcher } from '../../src/main/launch/steam-watch'
import { parseRegQuery } from '../../src/main/platform/registry'
import {
  parseAppId,
  readSteamStatusFromVdf,
  runningAppIdFromVdf,
  steamRawStatusFromVdf,
  toSteamStatus,
  type SteamStatus
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
          "ActiveProcess"
          {
            "pid"    "4242"
          }
          "Apps"
          {
            "1145360"
            {
              "Updating"    "1"
              "Running"    "0"
            }
            "620"
            {
              "Updating"    "0"
            }
          }
        }
      }
    }
  }
}`

describe('Steam status', () => {
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
    expect(steamRawStatusFromVdf(REGISTRY_VDF, [1145360, 620, 70])).toEqual({
      runningAppId: '1145360',
      pid: '4242',
      updating: { 1145360: '1', 620: '0', 70: undefined }
    })

    const dir = tempDir()
    writeFileSync(join(dir, 'registry.vdf'), REGISTRY_VDF.replace('"4242"', '"0"'))
    expect(
      await readSteamStatusFromVdf([join(dir, 'missing.vdf'), join(dir, 'registry.vdf')], [620])
    ).toEqual({ runningAppId: 1145360, clientRunning: false, updatingAppIds: [] })
    expect(await readSteamStatusFromVdf([join(dir, 'missing.vdf')], [])).toEqual({
      runningAppId: null,
      clientRunning: null,
      updatingAppIds: []
    })
  })

  it('checks the client pid against the OS and lists the games being updated', () => {
    const alive = (pid: number) => pid === 4242
    const raw = { runningAppId: '0x0', pid: '0x1092', updating: { 620: '0x1', 70: '0x0' } }
    expect(toSteamStatus(raw, alive)).toEqual({
      runningAppId: 0,
      clientRunning: true,
      updatingAppIds: [620]
    })
    // Stale pid (Steam crashed), Steam closed, pid unknown.
    expect(toSteamStatus({ ...raw, pid: '17' }, alive).clientRunning).toBe(false)
    expect(toSteamStatus({ ...raw, pid: '0' }, alive).clientRunning).toBe(false)
    expect(toSteamStatus({ updating: {} }, alive)).toEqual({
      runningAppId: null,
      clientRunning: null,
      updatingAppIds: []
    })
    // The real check: this process exists.
    expect(toSteamStatus({ pid: String(process.pid), updating: {} }).clientRunning).toBe(true)
  })
})

describe('SteamWatcher', () => {
  let watcher: SteamWatcher | undefined
  afterEach(() => watcher?.dispose())

  function setup(startTimeoutMs = 60_000) {
    const state: SteamStatus & { now: number; asked: number[][] } = {
      runningAppId: 0,
      clientRunning: true,
      updatingAppIds: [],
      now: 0,
      asked: []
    }
    const events: string[] = []
    watcher = new SteamWatcher({
      readStatus: async (appIds) => {
        state.asked.push(appIds)
        return { ...state }
      },
      pollMs: 3_600_000, // polled by hand
      pendingPollMs: 3_600_000,
      startTimeoutMs,
      now: () => state.now
    })
    watcher.on('change', (ids) => events.push(`change:${ids.join(',')}`))
    watcher.on('ended', (id) => events.push(`ended:${id}`))
    watcher.on('phase', (id, phase) => events.push(`phase:${id}:${phase}`))
    watcher.on('expired', (id) => events.push(`expired:${id}`))
    return { state, events, watcher }
  }

  it('follows a Steam game from start to end', async () => {
    const { state, events, watcher } = setup()
    expect(watcher.watch(7, 1145360)).toBe(true)
    await watcher.poll() // Steam still starting the game
    expect(watcher.runningIds()).toEqual([])
    expect(state.asked.at(-1)).toEqual([1145360])

    state.runningAppId = 1145360
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([7])
    expect(watcher.isRunning(7)).toBe(true)
    expect(watcher.watch(7, 1145360)).toBe(false) // already running

    state.runningAppId = null // unreadable for a moment: not an end
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([7])
    expect(state.asked.at(-1)).toEqual([]) // nothing pending: no update flag to read

    state.runningAppId = 0
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([])
    expect(events).toEqual(['phase:7:waiting', 'change:7', 'change:', 'ended:7'])
  })

  it('tells the launch phases: Steam starting, updating the game, starting it', async () => {
    const { state, events, watcher } = setup()
    state.clientRunning = false
    watcher.watch(7, 620)
    await watcher.poll()
    await watcher.poll() // same phase: no event
    state.clientRunning = true
    state.updatingAppIds = [620]
    await watcher.poll()
    state.updatingAppIds = []
    await watcher.poll()
    state.runningAppId = 620
    await watcher.poll()
    expect(events).toEqual(['phase:7:launcher', 'phase:7:updating', 'phase:7:waiting', 'change:7'])
  })

  it('gives up when the game never starts, but never during an update', async () => {
    const { state, events, watcher } = setup(1_000)
    state.updatingAppIds = [620]
    watcher.watch(7, 620)
    await watcher.poll()
    state.now = 5_000 // a long update: still waiting
    await watcher.poll()
    state.updatingAppIds = []
    state.now = 5_500
    await watcher.poll() // progress: the deadline moves
    state.now = 6_000
    await watcher.poll()
    state.now = 7_000
    await watcher.poll()
    state.runningAppId = 620
    await watcher.poll()
    expect(events).toEqual(['phase:7:updating', 'phase:7:waiting', 'expired:7'])
  })

  it('stops waiting when asked, and ignores invalid app ids', async () => {
    const { state, events, watcher } = setup()
    expect(watcher.watch(7, Number('abc'))).toBe(false)
    watcher.watch(8, 620)
    watcher.unwatch(8)
    state.runningAppId = 620
    await watcher.poll()
    expect(watcher.runningIds()).toEqual([])
    expect(events).toEqual([])
  })
})
