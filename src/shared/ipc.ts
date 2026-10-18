// Single source of truth for IPC: every channel, its arguments and its result.
// main registers handlers with `handle()`, preload exposes `invoke()`, renderer calls `window.shelf.invoke()`.

import type { SerializedAppError } from './errors'
import type {
  Game,
  GameDetail,
  GameInput,
  GamePatch,
  LaunchResult,
  PickedExecutable
} from './models'

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

  'games:list': { args: []; result: Game[] }
  'games:get': { args: [id: number]; result: GameDetail }
  'games:create': { args: [input: GameInput]; result: Game }
  'games:update': { args: [id: number, patch: GamePatch]; result: Game }
  'games:delete': { args: [id: number]; result: null }
  'games:pickExecutable': { args: []; result: PickedExecutable | null }
  'games:launch': { args: [id: number]; result: LaunchResult }
  'games:running': { args: []; result: number[] }
  'games:openFolder': { args: [id: number]; result: null }
}

export type IpcChannel = keyof IpcChannels
export type IpcArgs<C extends IpcChannel> = IpcChannels[C]['args']
export type IpcResult<C extends IpcChannel> = IpcChannels[C]['result']

// Record<IpcChannel, true> forces this list to stay exhaustive when a channel is added.
const CHANNELS: Record<IpcChannel, true> = {
  'app:ping': true,
  'app:info': true,
  'games:list': true,
  'games:get': true,
  'games:create': true,
  'games:update': true,
  'games:delete': true,
  'games:pickExecutable': true,
  'games:launch': true,
  'games:running': true,
  'games:openFolder': true
}
export const IPC_CHANNELS = Object.keys(CHANNELS) as IpcChannel[]

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.hasOwn(CHANNELS, value)
}

// Main → renderer notifications, pushed on EVENT_CHANNEL as (name, payload).
export interface IpcEvents {
  /** Ids of the games whose process Shelf is currently following. */
  'games:running': number[]
  /** The library changed outside a renderer request (session ended, sync, metadata…). */
  'library:changed': { reason: string }
}
export type IpcEvent = keyof IpcEvents

export const EVENT_CHANNEL = 'shelf:event'
const EVENTS: Record<IpcEvent, true> = { 'games:running': true, 'library:changed': true }

export function isIpcEvent(value: unknown): value is IpcEvent {
  return typeof value === 'string' && Object.hasOwn(EVENTS, value)
}

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: SerializedAppError }

// contextBridge drops custom Error properties, so the bridge returns the raw envelope
// and the renderer's `call()` helper turns failures into AppError.
export interface ShelfApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResponse<IpcResult<C>>>
  /** Subscribes to a main-process event; returns the unsubscribe function. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
