import { describe, expect, it } from 'vitest'
import { AppError, toSerializedError } from '../../src/shared/errors'
import { IPC_CHANNELS, isIpcChannel, isIpcEvent } from '../../src/shared/ipc'

describe('ipc contract', () => {
  it('lists every declared channel once, as domain:action', () => {
    expect(IPC_CHANNELS).toContain('app:ping')
    expect(IPC_CHANNELS).toContain('games:launch')
    expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length)
    for (const channel of IPC_CHANNELS) expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/)
  })

  it('whitelists main-process events', () => {
    expect(isIpcEvent('games:running')).toBe(true)
    expect(isIpcEvent('library:changed')).toBe(true)
    expect(isIpcEvent('constructor')).toBe(false)
  })

  it('rejects unknown or inherited channel names', () => {
    expect(isIpcChannel('app:ping')).toBe(true)
    expect(isIpcChannel('app:nope')).toBe(false)
    expect(isIpcChannel('toString')).toBe(false)
    expect(isIpcChannel(42)).toBe(false)
  })
})

describe('error serialization', () => {
  it('keeps the code of an AppError', () => {
    expect(toSerializedError(new AppError('NOT_FOUND', 'missing'))).toEqual({
      code: 'NOT_FOUND',
      message: 'missing'
    })
  })

  it('maps unknown errors to INTERNAL', () => {
    expect(toSerializedError(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' })
    expect(toSerializedError('raw')).toEqual({ code: 'INTERNAL', message: 'raw' })
  })

  it('round-trips through from()', () => {
    const error = AppError.from({ code: 'VALIDATION', message: 'bad' })
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('VALIDATION')
  })
})
