// Single source of truth for IPC: every channel, its arguments and its result.
// main registers handlers with `handle()`, preload exposes `invoke()`, renderer calls `window.shelf.invoke()`.

import type { SerializedAppError } from './errors'
import type {
  Account,
  ApiKeyService,
  ApiKeysInput,
  AppSettings,
  CacheInfo,
  Collection,
  ConnectInput,
  ConnectionTest,
  Game,
  GameDetail,
  GameInput,
  GamePatch,
  ImportDecision,
  ImportReport,
  LauncherStatus,
  LaunchResult,
  MetadataMatch,
  PickedExecutable,
  ScanResult,
  SettingsView,
  SmartRules,
  SyncReport,
  Tag
} from './models'

export interface ScanOptions {
  /** Default true. */
  includeLaunchers?: boolean
  /** Default: the folders saved in the settings. */
  folders?: string[]
}

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
  /** Opens the launcher's install page (owned, not installed). */
  'games:install': { args: [id: number]; result: null }

  'tags:list': { args: []; result: Tag[] }
  'tags:delete': { args: [id: number]; result: null }
  'games:setTags': { args: [gameId: number, names: string[]]; result: Game }
  'collections:list': { args: []; result: Collection[] }
  'collections:create': { args: [name: string, rules?: SmartRules | null]; result: Collection }
  'collections:update': {
    args: [id: number, patch: { name?: string; rules?: SmartRules | null }]
    result: Collection
  }
  'collections:delete': { args: [id: number]; result: null }
  'collections:addGames': { args: [id: number, gameIds: number[]]; result: Collection }
  'collections:removeGame': { args: [id: number, gameId: number]; result: Collection }

  'launchers:list': { args: []; result: LauncherStatus[] }
  'import:scan': { args: [options?: ScanOptions]; result: ScanResult }
  'import:apply': { args: [decisions: ImportDecision[]]; result: ImportReport }
  'import:pickFolder': { args: []; result: string | null }

  'accounts:list': { args: []; result: Account[] }
  'accounts:connect': {
    args: [input: ConnectInput]
    result: { account: Account; sync: SyncReport }
  }
  'accounts:disconnect': { args: [id: string]; result: null }
  /** Syncs one account, or all of them when no id is given. */
  'accounts:sync': { args: [id?: string]; result: SyncReport[] }

  'metadata:search': { args: [title: string]; result: MetadataMatch[] }
  /** igdbId null = keep the text metadata, refresh the artwork only. */
  'metadata:apply': { args: [gameId: number, igdbId: number | null]; result: Game }
  'metadata:refreshArtwork': { args: [gameId: number]; result: Game }
  'games:pickCover': { args: [gameId: number]; result: Game | null }
  'keys:set': { args: [input: ApiKeysInput]; result: SettingsView }
  'keys:clear': { args: [service: ApiKeyService]; result: SettingsView }
  'keys:test': { args: [service: ApiKeyService]; result: ConnectionTest }
  'cache:info': { args: []; result: CacheInfo }
  'cache:clear': { args: []; result: CacheInfo }

  'settings:get': { args: []; result: SettingsView }
  'settings:update': { args: [patch: Partial<AppSettings>]; result: SettingsView }
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
  'games:openFolder': true,
  'games:install': true,
  'accounts:list': true,
  'accounts:connect': true,
  'accounts:disconnect': true,
  'accounts:sync': true,
  'tags:list': true,
  'tags:delete': true,
  'games:setTags': true,
  'collections:list': true,
  'collections:create': true,
  'collections:update': true,
  'collections:delete': true,
  'collections:addGames': true,
  'collections:removeGame': true,
  'launchers:list': true,
  'import:scan': true,
  'import:apply': true,
  'import:pickFolder': true,
  'metadata:search': true,
  'metadata:apply': true,
  'metadata:refreshArtwork': true,
  'games:pickCover': true,
  'keys:set': true,
  'keys:clear': true,
  'keys:test': true,
  'cache:info': true,
  'cache:clear': true,
  'settings:get': true,
  'settings:update': true
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
