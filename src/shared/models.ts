// Data transfer objects exchanged over IPC. Plain JSON: numbers for timestamps (ms since epoch).

import type { GameSourceId, InstallState, Ownership } from './domain'

export interface Game {
  id: number
  title: string
  source: GameSourceId
  sourceId: string
  ownership: Ownership
  installState: InstallState
  installPath: string | null
  executablePath: string | null
  launchArgs: string | null
  /** `shelf-media://` URLs of cached artwork, null when missing. */
  coverUrl: string | null
  heroUrl: string | null
  logoUrl: string | null
  screenshotUrls: string[]
  description: string | null
  releaseDate: string | null
  developer: string | null
  genres: string[]
  igdbId: number | null
  favorite: boolean
  hidden: boolean
  addedAt: number
  lastSyncedAt: number | null
  /**
   * Total playtime: the launcher's figure (Steam `playtime_forever`, GOG Galaxy) plus the
   * sessions Shelf measured itself. Launcher launches (`steam://`…) are never measured by
   * Shelf, so nothing is counted twice.
   */
  playtimeSec: number
  /** Part measured by Shelf (launched executables). */
  localPlaytimeSec: number
  /** Time reported by the launcher account, null when it exposes none. */
  externalPlaytimeMin: number | null
  lastPlayedAt: number | null
  lastSessionSec: number | null
  sessionCount: number
  tags: string[]
  collectionIds: number[]
  savePath: string | null
  /** Linux: launch the executable through the configured Wine/Proton runner. */
  useRunner: boolean
  canInstall: boolean
  canUninstall: boolean
}

export interface GameInput {
  title: string
  executablePath: string
  launchArgs?: string | null
  installPath?: string | null
}

export interface GamePatch {
  title?: string
  executablePath?: string | null
  launchArgs?: string | null
  installPath?: string | null
  favorite?: boolean
  hidden?: boolean
  description?: string | null
  releaseDate?: string | null
  developer?: string | null
  genres?: string[]
  savePath?: string | null
  useRunner?: boolean
}

export interface PlaySession {
  id: number
  gameId: number
  startedAt: number
  endedAt: number | null
  durationSec: number | null
}

export interface GameDetail {
  game: Game
  sessions: PlaySession[]
}

export interface PickedExecutable {
  path: string
  suggestedTitle: string
  installPath: string
}

export interface LaunchResult {
  /** true when Shelf owns the process and measures the session itself. */
  tracked: boolean
  method: 'process' | 'uri'
}

export interface Tag {
  id: number
  name: string
  count: number
}

/** Smart collection: every set criterion must match (AND). */
export interface SmartRules {
  sources?: GameSourceId[]
  tags?: string[]
  genres?: string[]
  installed?: boolean
  favorite?: boolean
  neverPlayed?: boolean
  minPlaytimeHours?: number
}

export interface Collection {
  id: number
  name: string
  rules: SmartRules | null
  /** Manual collections: ordered members. Smart collections: computed by the renderer. */
  gameIds: number[]
}

// Detection & import (phase 2)

export interface LauncherStatus {
  source: GameSourceId
  name: string
  available: boolean
  location: string | null
  gameCount: number
  enabled: boolean
}

export type CandidateStatus = 'new' | 'update' | 'duplicate' | 'excluded'

export interface ImportCandidate {
  key: string
  source: GameSourceId
  sourceId: string
  title: string
  executablePath: string | null
  installPath: string | null
  status: CandidateStatus
  /** Folder-scan finds need a human look; launcher finds are trusted. */
  needsReview: boolean
  duplicateOf: { id: number; title: string; source: GameSourceId } | null
  excludedReason: string | null
}

export interface SourceError {
  source: GameSourceId
  message: string
}

export interface ScanResult {
  candidates: ImportCandidate[]
  launchers: LauncherStatus[]
  errors: SourceError[]
}

export type ImportAction = 'import' | 'merge' | 'ignore'

export interface ImportDecision {
  key: string
  action: ImportAction
  title?: string
  igdbId?: number | null
}

export interface ImportReport {
  imported: number
  updated: number
  merged: number
  ignored: number
  markedNotInstalled: number
}

// Accounts (phase 2b)

export const ACCOUNT_KINDS = ['steam', 'gog-galaxy', 'gog-oauth', 'epic-legendary', 'itch'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

export interface Account {
  id: string
  kind: AccountKind
  source: GameSourceId
  displayName: string
  externalUserId: string
  lastSyncAt: number | null
  lastError: string | null
  gameCount: number
}

export type ConnectInput =
  | { kind: 'steam'; apiKey: string; steamId: string }
  | { kind: 'itch'; apiKey: string }
  | { kind: 'gog-galaxy' }
  | { kind: 'gog-oauth' }
  | { kind: 'epic-legendary' }

export interface SyncReport {
  accountId: string
  added: number
  updated: number
  total: number
  error: string | null
}

// Metadata (phase 3)

export interface MetadataMatch {
  igdbId: number
  name: string
  year: number | null
  developer: string | null
  /** Cached thumbnail (`shelf-media://`), null if none or not downloaded. */
  thumbUrl: string | null
}

export type ApiKeyService = 'igdb' | 'steamgriddb'

export interface ApiKeysInput {
  igdbClientId?: string
  igdbClientSecret?: string
  steamGridDbKey?: string
}

export interface ConnectionTest {
  ok: boolean
  message: string
}

export interface CacheInfo {
  bytes: number
  files: number
}

// Settings

export type CoverSize = 'sm' | 'md' | 'lg'

export interface AppSettings {
  onboardingDone: boolean
  /** Launchers scanned by the detection; all by default. */
  enabledLaunchers: GameSourceId[]
  scanFolders: string[]
  /** Extra file-name fragments excluded by the folder scan. */
  extraExclusions: string[]
  launchAtStartup: boolean
  minimizeToTray: boolean
  /** Wine / Proton executable used for `.exe` games on Linux. */
  runnerPath: string | null
  /** GOG option B: unofficial OAuth login, off by default. */
  gogOAuthEnabled: boolean
  coverSize: CoverSize
  showHidden: boolean
}

export interface SettingsView extends AppSettings {
  igdbConfigured: boolean
  steamGridDbConfigured: boolean
  secretsAvailable: boolean
  platform: string
}
