// Single source of truth for IPC: every channel, its arguments and its result.
// main registers handlers with `handle()`, preload exposes `invoke()`, renderer calls `window.shelf.invoke()`.

import type { GameSourceId } from './domain'
import type { SerializedAppError } from './errors'
import type {
  Account,
  ApiKeyService,
  AchievementsView,
  ApiKeysInput,
  AppSettings,
  CacheInfo,
  Collection,
  CommunityItem,
  CommunityKind,
  ConnectInput,
  ConnectionTest,
  Game,
  GameDetail,
  GameInsights,
  GameInput,
  GamePatch,
  ImportDecision,
  ImportReport,
  KeyshopView,
  LauncherStatus,
  InstallLocations,
  InstallProgress,
  InstallRequest,
  InstallStart,
  PickedInstallFolder,
  LaunchProgress,
  LaunchResult,
  MetadataMatch,
  NewsItem,
  PickedExecutable,
  PurchaseInput,
  PurchaseResult,
  ScanResult,
  SettingsView,
  SmartRules,
  StoreGame,
  StoreGameDetail,
  StoreGameRef,
  SyncReport,
  Tag,
  WishlistView
} from './models'

export interface BackupResult {
  path: string
  files: number
  bytes: number
}

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
  /** Launches in progress (clicked, the game not running yet). */
  'games:launching': { args: []; result: LaunchProgress[] }
  /** Stops waiting for a launch (the launcher keeps going on its own). */
  'games:cancelLaunch': { args: [id: number]; result: null }
  'games:openFolder': { args: [id: number]; result: null }
  /**
   * Installs an owned game: in the background when the launcher allows it (Steam, Epic via
   * Legendary), otherwise opens the launcher's install page.
   */
  'games:install': { args: [id: number, request?: InstallRequest]; result: InstallStart }
  /** Where a background install may go (null: no background install for this launcher). */
  'games:installLocations': { args: [source: GameSourceId]; result: InstallLocations | null }
  /** Folder picker for installs: the folder as the launcher will use it, null when cancelled. */
  'games:pickInstallFolder': {
    args: [source: GameSourceId]
    result: PickedInstallFolder | null
  }
  /** Installs started in the background and not finished yet. */
  'games:installing': { args: []; result: InstallProgress[] }
  /** Stops a background install (or only stops following it when it cannot be stopped). */
  'games:cancelInstall': { args: [id: number]; result: null }
  /** Opens the launcher's uninstall flow (Steam). */
  'games:uninstall': { args: [id: number]; result: null }
  /** Opens the launcher where the pending update of the game gets applied. */
  'games:applyUpdate': { args: [id: number]; result: null }
  /** Re-reads the launchers' files now; returns how many installed games have an update pending. */
  'games:checkUpdates': { args: []; result: number }
  'games:pickSaveFolder': { args: [id: number]; result: Game | null }
  'games:exportSaves': { args: [id: number]; result: BackupResult | null }

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
  /** Game page extras: one call per block, so a failing service only empties its own. */
  'insights:overview': { args: [gameId: number]; result: GameInsights }
  'insights:news': { args: [gameId: number]; result: NewsItem[] }
  'insights:community': { args: [gameId: number, kind: CommunityKind]; result: CommunityItem[] }
  'insights:achievements': { args: [gameId: number]; result: AchievementsView }
  /** Store: wishlist (Steam account + Shelf list), re-importing the Steam one when stale. */
  'store:wishlist': { args: []; result: WishlistView }
  'store:syncWishlist': { args: []; result: WishlistView }
  'store:deals': { args: []; result: StoreGame[] }
  'store:search': { args: [query: string]; result: StoreGame[] }
  /** Purchase sheet: every store's offer, where "Acheter" opens. */
  'store:game': { args: [ref: StoreGameRef]; result: StoreGameDetail }
  /** Key reseller prices (Instant Gaming), apart: never fails, `error` explains a failure. */
  'store:keyshops': { args: [ref: StoreGameRef]; result: KeyshopView }
  /** Store page of a game to buy: the game page's Steam blocks, by Steam appid. */
  'store:overview': { args: [steamAppId: string]; result: GameInsights }
  'store:news': { args: [steamAppId: string]; result: NewsItem[] }
  'store:addWish': { args: [ref: StoreGameRef]; result: null }
  'store:removeWish': { args: [id: number]; result: null }
  /** Opens the launcher's store page (or the browser) and follows the purchase. */
  'store:buy': { args: [input: PurchaseInput]; result: PurchaseResult }
  'cache:info': { args: []; result: CacheInfo }
  'cache:clear': { args: []; result: CacheInfo }

  'settings:get': { args: []; result: SettingsView }
  'settings:update': { args: [patch: Partial<AppSettings>]; result: SettingsView }
  'settings:pickRunner': { args: []; result: SettingsView | null }
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
  'games:launching': true,
  'games:cancelLaunch': true,
  'games:openFolder': true,
  'games:install': true,
  'games:installLocations': true,
  'games:pickInstallFolder': true,
  'games:installing': true,
  'games:cancelInstall': true,
  'games:uninstall': true,
  'games:applyUpdate': true,
  'games:checkUpdates': true,
  'games:pickSaveFolder': true,
  'games:exportSaves': true,
  'settings:pickRunner': true,
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
  'insights:overview': true,
  'insights:news': true,
  'insights:community': true,
  'insights:achievements': true,
  'store:wishlist': true,
  'store:syncWishlist': true,
  'store:deals': true,
  'store:search': true,
  'store:game': true,
  'store:keyshops': true,
  'store:overview': true,
  'store:news': true,
  'store:addWish': true,
  'store:removeWish': true,
  'store:buy': true,
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
  /** Launches in progress, pushed whenever one starts, changes phase or ends. */
  'games:launching': LaunchProgress[]
  /** A launched game never showed up (the launcher may be waiting for the user). */
  'games:launchTimeout': { gameId: number; title: string; launcher: GameSourceId | null }
  /** Background installs, pushed whenever one starts, progresses or ends. */
  'games:installing': InstallProgress[]
  /** A background install ended: installed, failed (`error`) or cancelled. */
  'games:installEnded': {
    gameId: number
    title: string
    outcome: 'installed' | 'failed' | 'cancelled'
    error?: string
  }
  /** The library changed outside a renderer request (session ended, sync, metadata…). */
  'library:changed': { reason: string }
  /** A game bought from the store showed up in the library. */
  'store:purchased': { title: string; gameId: number }
}
export type IpcEvent = keyof IpcEvents

export const EVENT_CHANNEL = 'shelf:event'
const EVENTS: Record<IpcEvent, true> = {
  'games:running': true,
  'games:launching': true,
  'games:launchTimeout': true,
  'games:installing': true,
  'games:installEnded': true,
  'library:changed': true,
  'store:purchased': true
}

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
