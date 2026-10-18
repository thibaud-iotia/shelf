// Single source of truth for IPC: every channel, its arguments and its result.
// main registers handlers with `handle()`, preload exposes `invoke()`, renderer calls `window.shelf.invoke()`.

import type { SerializedAppError } from './errors'

export interface PingResult {
  message: 'pong'
  receivedAt: string
}

export interface AppInfo {
  name: string
  version: string
  electronVersion: string
  platform: string
  userDataPath: string
  databasePath: string
  appliedMigrations: number
}

export interface IpcChannels {
  'app:ping': { args: []; result: PingResult }
  'app:info': { args: []; result: AppInfo }
}

export type IpcChannel = keyof IpcChannels
export type IpcArgs<C extends IpcChannel> = IpcChannels[C]['args']
export type IpcResult<C extends IpcChannel> = IpcChannels[C]['result']

// Record<IpcChannel, true> forces this list to stay exhaustive when a channel is added.
const CHANNELS: Record<IpcChannel, true> = {
  'app:ping': true,
  'app:info': true
}
export const IPC_CHANNELS = Object.keys(CHANNELS) as IpcChannel[]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.hasOwn(CHANNELS, value)
}

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: SerializedAppError }

// contextBridge drops custom Error properties, so the bridge returns the raw envelope
// and the renderer's `call()` helper turns failures into AppError.
export interface ShelfApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResponse<IpcResult<C>>>
}
