// Data transfer objects exchanged over IPC. Plain JSON: numbers for timestamps (ms since epoch).

import type { GameSourceId, InstallState, Ownership } from './domain'

export interface Game {
  id: number
  title: string
  source: GameSourceId
  sourceId: string
  ownership: Ownership
  installState: InstallState
  /** The launcher has an update pending for the installed copy (Steam, Epic, Legendary). */
  updateAvailable: boolean
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
  /** Steam store appid behind news, videos, reviews… (null: none found yet). */
  steamAppId: string | null
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
  /** Most recent play: Shelf's sessions or the launcher's date, whichever is later. */
  lastPlayedAt: number | null
  /** Length of that play, null when it comes from the launcher. */
  lastSessionSec: number | null
  sessionCount: number
  tags: string[]
  collectionIds: number[]
  savePath: string | null
  /** Linux: launch the executable through the configured Wine/Proton runner. */
  useRunner: boolean
  canInstall: boolean
  canUninstall: boolean
  /** An update is pending and the launcher can be opened to apply it. */
  canUpdate: boolean
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
  /** null: found again by a Steam store search. */
  steamAppId?: string | null
}

export interface PlaySession {
  id: number
  gameId: number
  startedAt: number
  endedAt: number | null
  durationSec: number | null
}

/** Add-on owned for a game (DLC, cosmetic pack, expansion): shown on its page only. */
export interface GameDlc {
  id: number
  title: string
}

export interface GameDetail {
  game: Game
  sessions: PlaySession[]
  dlcs: GameDlc[]
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
  /** Launcher finds only: an update is pending for this install. */
  updateAvailable: boolean
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

// Game page extras ("comme sur Steam"): news, videos, reviews, community, achievements.
// Image URLs are `shelf-media://` (proxied by the main process); links are https.

export interface NewsItem {
  id: string
  title: string
  url: string
  author: string | null
  /** ms since epoch. */
  date: number
  /** Feed name shown next to the date ("Annonce officielle", "Rock, Paper, Shotgun"…). */
  feed: string
  /** Posted by the developer on Steam (not a press article). */
  official: boolean
  summary: string
  imageUrl: string | null
}

export interface GameVideo {
  id: string
  title: string
  kind: 'steam' | 'youtube'
  posterUrl: string | null
  /** Steam: mp4 URLs, best first. YouTube: the embed URL. */
  sources: string[]
  /** Link opened in the browser (YouTube page, Steam store page). */
  pageUrl: string
}

export interface ReviewSummary {
  /** Steam's label, e.g. « extrêmement positives ». */
  label: string
  /** 1 (overwhelmingly negative) … 9 (overwhelmingly positive), 0 = not enough reviews. */
  score: number
  percentPositive: number
  count: number
  url: string
}

export const LINK_KINDS = [
  'official',
  'steam',
  'community',
  'wiki',
  'discord',
  'reddit',
  'twitter',
  'youtube',
  'twitch',
  'other'
] as const
export type LinkKind = (typeof LINK_KINDS)[number]

export interface GameLink {
  kind: LinkKind
  label: string
  url: string
}

/** A block of the Steam "About this game" text. */
export type AboutBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string }

export interface StoreScreenshot {
  thumbUrl: string
  fullUrl: string
}

export interface Requirement {
  label: string
  value: string
}

/** Store page details shown on the overview tab (Steam `appdetails`). */
export interface StoreInfo {
  shortDescription: string | null
  about: AboutBlock[]
  genres: string[]
  /** Steam features: "Solo", "Succès Steam", "Steam Cloud"… */
  features: string[]
  developers: string[]
  publishers: string[]
  /** As written by Steam ("17 sept. 2020", "Bientôt disponible"). */
  releaseDate: string | null
  comingSoon: boolean
  platforms: ('windows' | 'mac' | 'linux')[]
  /** "24,50 €", "Gratuit", or null when not sold. */
  price: string | null
  discountPercent: number
  controller: 'full' | 'partial' | null
  languages: { name: string; audio: boolean }[]
  requirements: { minimum: Requirement[]; recommended: Requirement[] }
  screenshots: StoreScreenshot[]
}

export interface GameInsights {
  steamAppId: string | null
  store: StoreInfo | null
  reviews: ReviewSummary | null
  playersOnline: number | null
  metacritic: { score: number; url: string | null } | null
  achievementsTotal: number | null
  videos: GameVideo[]
  links: GameLink[]
  /** A Steam account key is available (community shares and achievement progress). */
  steamKey: boolean
}

export const COMMUNITY_KINDS = ['screenshots', 'artwork', 'guides'] as const
export type CommunityKind = (typeof COMMUNITY_KINDS)[number]

export interface CommunityItem {
  id: string
  title: string
  description: string | null
  previewUrl: string | null
  url: string
  votesUp: number
  /** ms since epoch. */
  createdAt: number
}

export interface Achievement {
  id: string
  name: string
  description: string | null
  iconUrl: string | null
  hidden: boolean
  /** null when the player's progress is unknown (no Steam account or not a Steam game). */
  unlocked: boolean | null
  unlockedAt: number | null
  /** Share of Steam players who unlocked it. */
  percent: number | null
}

export interface AchievementsView {
  total: number
  /** null when the progress is unknown. */
  unlocked: number | null
  items: Achievement[]
  /** Why the progress is missing, shown above the list. */
  note: string | null
}

// Store (wishlist, prices, purchase through the launchers)

/** Where "Acheter" opens: the launcher's store page, or the browser. */
export type PurchaseOpener = 'steam' | 'gog' | 'browser'

/** A price in euros, as a store displays it. */
export interface LocalPrice {
  /** "24,50 €", "Gratuit". */
  final: string
  /** Price before the discount, null when not discounted. */
  base: string | null
  discountPct: number
}

/** Cheapest CheapShark deal (prices in US dollars, CheapShark's only currency). */
export interface BestDeal {
  storeId: string
  storeName: string
  dealId: string
  price: number
  retailPrice: number
  discountPct: number
}

/** A game in the store views (wishlist, deals, search results). */
export interface StoreGame {
  /** Stable key: "steam:<appid>" or "cs:<cheapshark id>". */
  key: string
  title: string
  steamAppId: string | null
  cheapsharkId: string | null
  /** Remote image URL (shown through the image proxy). */
  imageUrl: string | null
  best: BestDeal | null
  /** Steam store price in euros. */
  steamPrice: LocalPrice | null
  /** Library game matching this one (already owned). */
  ownedGameId: number | null
  wishlist: { id: number; fromSteam: boolean; byUser: boolean } | null
  steamRating: { text: string; percent: number } | null
}

export interface StoreOffer {
  storeId: string
  storeName: string
  /** CheapShark deal (US dollars); null for an offer only known from the store itself. */
  dealId: string | null
  price: number | null
  retailPrice: number | null
  discountPct: number
  /** Price in euros from the store itself (Steam, GOG). */
  localPrice: LocalPrice | null
  opensIn: PurchaseOpener
  /** GOG product found by title: id (Galaxy) and slug (web page). */
  gog: { id: string; slug: string } | null
}

export interface StoreGameDetail extends StoreGame {
  /** Wide artwork for the page header (proxied), null when the store has none. */
  heroUrl: string | null
  offers: StoreOffer[]
  /** Lowest price ever seen by CheapShark, US dollars. */
  lowestEver: { price: number; date: number } | null
}

export interface WishlistView {
  items: StoreGame[]
  steam: {
    /** A Steam account is connected (its wishlist is imported). */
    connected: boolean
    syncedAt: number | null
    error: string | null
  }
  /** Prices could not be fetched (items are still listed). */
  pricesError: string | null
}

/** What identifies a store game across calls (wishlist add, detail, purchase). */
export interface StoreGameRef {
  title: string
  steamAppId: string | null
  cheapsharkId: string | null
  imageUrl?: string | null
}

export interface PurchaseInput extends StoreGameRef {
  storeId: string
  dealId: string | null
  gog: { id: string; slug: string } | null
}

export interface PurchaseResult {
  opensIn: PurchaseOpener
}
