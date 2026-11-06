import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/main/launch/args'
import { buildLaunchPlan, type LaunchOptions } from '../../src/main/launch/plan'
import { GameRunner } from '../../src/main/launch/runner'
import { installUri, launchUri, uninstallUri, updateUri } from '../../src/main/sources/uris'

const fakeGame = resolve(__dirname, '../fixtures/fake-game.cjs')

describe('parseArgs', () => {
  it.each([
    ['', []],
    ['-windowed', ['-windowed']],
    ['  -a   -b ', ['-a', '-b']],
    ['--profile "My Profile" -x', ['--profile', 'My Profile', '-x']],
    ["--name 'a b' c", ['--name', 'a b', 'c']],
    ['--empty ""', ['--empty', '']],
    ['--quote "say \\"hi\\""', ['--quote', 'say "hi"']],
    ['-path=C:\\Games\\X', ['-path=C:\\Games\\X']]
  ])('%s', (input, expected) => {
    expect(parseArgs(input)).toEqual(expected)
  })

  it('handles null', () => expect(parseArgs(null)).toEqual([]))
})

const options: LaunchOptions = { platform: 'win32', runnerPath: null, protonPrefix: '/p' }
const manual = {
  source: 'manual' as const,
  sourceId: 'uuid',
  executablePath: 'C:\\Games\\Hollow\\hollow.exe',
  launchArgs: '-windowed',
  useRunner: false
}

describe('buildLaunchPlan', () => {
  it('spawns manual games from their own folder', () => {
    expect(buildLaunchPlan(manual, options)).toMatchObject({
      kind: 'process',
      command: manual.executablePath,
      args: ['-windowed']
    })
  })

  it('always goes through the launcher for Steam and Epic', () => {
    expect(buildLaunchPlan({ ...manual, source: 'steam', sourceId: '1145360' }, options)).toEqual({
      kind: 'uri',
      uri: 'steam://rungameid/1145360'
    })
    expect(buildLaunchPlan({ ...manual, source: 'epic', sourceId: 'Fortnite' }, options)).toEqual({
      kind: 'uri',
      uri: 'com.epicgames.launcher://apps/Fortnite?action=launch&silent=true'
    })
  })

  it('starts Steam minimized when its executable is known', () => {
    const steamExe = 'C:\\Steam\\steam.exe'
    expect(
      buildLaunchPlan(
        { ...manual, source: 'steam', sourceId: '1145360' },
        { ...options, steamExecutable: steamExe }
      )
    ).toEqual({
      kind: 'launcher',
      command: steamExe,
      args: ['-silent', 'steam://rungameid/1145360'],
      uri: 'steam://rungameid/1145360'
    })
  })

  it('falls back to the launcher URI for GOG games without executable', () => {
    expect(
      buildLaunchPlan(
        { ...manual, source: 'gog', sourceId: '1207658924', executablePath: null },
        options
      )
    ).toEqual({ kind: 'uri', uri: 'goggalaxy://openGameView/1207658924' })
  })

  it('rejects a manual game without executable', () => {
    expect(() => buildLaunchPlan({ ...manual, executablePath: null }, options)).toThrow(
      /Aucun exécutable/
    )
  })

  it('wraps .exe games with Wine on Linux', () => {
    const plan = buildLaunchPlan(manual, {
      ...options,
      platform: 'linux',
      runnerPath: '/usr/bin/wine'
    })
    expect(plan).toMatchObject({
      kind: 'process',
      command: '/usr/bin/wine',
      args: [manual.executablePath, '-windowed']
    })
  })

  it('uses `proton run` with a compat prefix', () => {
    const plan = buildLaunchPlan(
      { ...manual, useRunner: true },
      { ...options, platform: 'linux', runnerPath: '/opt/proton/Proton 9.0/proton' }
    )
    expect(plan).toMatchObject({
      kind: 'process',
      args: ['run', manual.executablePath, '-windowed'],
      env: { STEAM_COMPAT_DATA_PATH: '/p' }
    })
  })

  it('asks for a runner when one is required but missing', () => {
    expect(() =>
      buildLaunchPlan({ ...manual, useRunner: true }, { ...options, platform: 'linux' })
    ).toThrow(/Wine ou Proton/)
  })
})

describe('launcher URIs', () => {
  it('builds install and uninstall URIs', () => {
    expect(installUri({ source: 'steam', sourceId: '10' })).toBe('steam://install/10')
    expect(uninstallUri({ source: 'steam', sourceId: '10' })).toBe('steam://uninstall/10')
    expect(uninstallUri({ source: 'gog', sourceId: '10' })).toBeNull()
    expect(installUri({ source: 'manual', sourceId: 'x' })).toBeNull()
    expect(launchUri({ source: 'gog', sourceId: '1' }, 'linux')).toBe(
      'heroic://launch?appName=1&runner=gog'
    )
  })

  it('opens the launcher where a pending update gets applied', () => {
    expect(updateUri({ source: 'steam', sourceId: '10' })).toBe('steam://open/downloads')
    expect(updateUri({ source: 'epic', sourceId: 'Fortnite' }, 'win32')).toBe(
      'com.epicgames.launcher://apps/Fortnite?action=launch'
    )
    expect(updateUri({ source: 'epic', sourceId: 'Fortnite' }, 'linux')).toBe(
      'heroic://launch?appName=Fortnite&runner=legendary'
    )
    expect(updateUri({ source: 'gog', sourceId: '1' })).toBeNull()
    expect(updateUri({ source: 'manual', sourceId: 'x' })).toBeNull()
  })
})

describe('GameRunner', () => {
  function makeRunner() {
    const events: string[] = []
    let resolveExit: (value: { sessionId: number; endedAt: Date }) => void = () => {}
    const exited = new Promise<{ sessionId: number; endedAt: Date }>((r) => (resolveExit = r))
    const runner = new GameRunner({
      openExternal: async (uri) => {
        events.push(`open ${uri}`)
      },
      onStart: (gameId) => {
        events.push(`start ${gameId}`)
        return 99
      },
      onExit: (gameId, sessionId, endedAt) => {
        events.push(`exit ${gameId}`)
        resolveExit({ sessionId, endedAt })
      }
    })
    return { runner, events, exited }
  }

  it('hands launcher plans to the launcher without following them', async () => {
    const { runner, events } = makeRunner()
    const result = await runner.launch(3, {
      kind: 'launcher',
      command: process.execPath,
      args: ['-e', ''],
      uri: 'steam://rungameid/1'
    })
    expect(result).toEqual({ tracked: false, method: 'uri' })
    expect(events).toEqual([])
    expect(runner.isRunning(3)).toBe(false)
  })

  it('falls back to the URI when the launcher cannot start', async () => {
    const { runner, events } = makeRunner()
    await runner.launch(3, {
      kind: 'launcher',
      command: resolve(__dirname, 'missing-launcher.exe'),
      args: [],
      uri: 'steam://rungameid/1'
    })
    expect(events).toEqual(['open steam://rungameid/1'])
  })

  it('follows a real process until it exits', async () => {
    const { runner, events, exited } = makeRunner()
    const changes: number[][] = []
    runner.on('change', (ids) => changes.push(ids))

    const result = await runner.launch(7, {
      kind: 'process',
      command: process.execPath,
      args: [fakeGame, '300'],
      cwd: __dirname
    })
    expect(result).toEqual({ tracked: true, method: 'process' })
    expect(runner.isRunning(7)).toBe(true)
    await expect(
      runner.launch(7, { kind: 'process', command: process.execPath, args: [], cwd: __dirname })
    ).rejects.toThrow(/déjà en cours/)

    const { sessionId } = await exited
    expect(sessionId).toBe(99)
    expect(runner.isRunning(7)).toBe(false)
    expect(events).toEqual(['start 7', 'exit 7'])
    expect(changes).toEqual([[7], []])
  })

  it('opens URIs without tracking', async () => {
    const { runner, events } = makeRunner()
    expect(await runner.launch(1, { kind: 'uri', uri: 'steam://rungameid/1' })).toEqual({
      tracked: false,
      method: 'uri'
    })
    expect(events).toEqual(['open steam://rungameid/1'])
  })

  it('reports a missing executable clearly', async () => {
    const { runner } = makeRunner()
    await expect(
      runner.launch(1, {
        kind: 'process',
        command: resolve(__dirname, 'missing.exe'),
        args: [],
        cwd: __dirname
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
