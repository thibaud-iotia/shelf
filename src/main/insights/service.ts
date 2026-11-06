import { eq } from 'drizzle-orm'
import { AppError } from '../../shared/errors'
import type {
  AchievementsView,
  CommunityItem,
  CommunityKind,
  GameInsights,
  NewsItem
} from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { games } from '../db/schema'
import { getGameRow } from '../games/repository'
import type { IgdbExtras } from '../metadata/igdb'
import type { FetchLike } from '../net/http'
import { remoteImageUrl } from '../media/remote'
import { buildLinks, youtubeVideos } from './links'
import {
  communityHubUrl,
  matchStoreSearch,
  mergeAchievements,
  parseAppDetails,
  parseCommunity,
  parseNews,
  steamHeaderUrl,
  parsePlayers,
  parseReviews,
  steamKeyError,
  SteamStoreClient,
  steamVideos,
  storeInfo,
  storePageUrl
} from './steam-store'

export interface InsightsDeps {
  db: ShelfDatabase
  /** Key + SteamID of the connected Steam account, if any. */
  steamCredentials: () => { apiKey: string; steamId: string } | null
  /** IGDB videos and websites, null when IGDB is not configured. */
  igdbExtras: (igdbId: number) => Promise<IgdbExtras | null>
  fetch?: FetchLike
  now?: () => number
  ttlMs?: number
}

export const NO_STEAM_PAGE =
  'Aucune page Steam trouvée pour ce jeu : indiquez son AppID Steam dans « Modifier ».'
export const NO_STEAM_ACCOUNT =
  'Connectez un compte Steam (Réglages › Comptes) : sa clé API donne accès à ce contenu.'

/**
 * Game page extras: news, videos, reviews, players online, links, community shares and
 * achievements. Each block is a separate call so one failing service never empties the
 * others. Responses are kept in memory for `ttlMs` (failures are not kept).
 */
export class InsightsService {
  private readonly client: SteamStoreClient
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>()
  /** Store searches already done this session ("gameId:title" → appid or null). */
  private readonly searched = new Map<string, string | null>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(private readonly deps: InsightsDeps) {
    this.client = new SteamStoreClient(deps.fetch)
    this.now = deps.now ?? Date.now
    this.ttlMs = deps.ttlMs ?? 10 * 60_000
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.value as Promise<T>
    const value = load()
    this.cache.set(key, { expiresAt: this.now() + this.ttlMs, value })
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key)
    })
    return value
  }

  /**
   * Steam appid of a game: its own for Steam games, the one set by the user, else an
   * exact-title match of the Steam store search (saved on the game once found).
   */
  async steamAppId(gameId: number): Promise<string | null> {
    const row = getGameRow(this.deps.db, gameId)
    if (row.steamAppId) return row.steamAppId
    if (row.source === 'steam') return row.sourceId
    const key = `${row.id}:${row.title}`
    if (this.searched.has(key)) return this.searched.get(key) ?? null
    const found = matchStoreSearch(await this.client.search(row.title), row.title)
    this.searched.set(key, found)
    if (found) {
      this.deps.db.update(games).set({ steamAppId: found }).where(eq(games.id, row.id)).run()
    }
    return found
  }

  private async requireAppId(gameId: number): Promise<string> {
    const appId = await this.steamAppId(gameId)
    if (!appId) throw new AppError('NOT_FOUND', NO_STEAM_PAGE)
    return appId
  }

  private requireKey(): { apiKey: string; steamId: string } {
    const credentials = this.deps.steamCredentials()
    if (!credentials) throw new AppError('VALIDATION', NO_STEAM_ACCOUNT)
    return credentials
  }

  async overview(gameId: number): Promise<GameInsights> {
    const row = getGameRow(this.deps.db, gameId)
    const appId = await this.steamAppId(gameId).catch(() => null)
    return this.overviewOf(appId, row.igdbId)
  }

  /** Same blocks for a Steam app that is not in the library (store page of a game to buy). */
  overviewForApp(appId: string): Promise<GameInsights> {
    return this.overviewOf(appId, null)
  }

  private async overviewOf(appId: string | null, igdbId: number | null): Promise<GameInsights> {
    const quiet = <T>(promise: Promise<T> | null): Promise<T | null> =>
      promise ? promise.catch(() => null) : Promise.resolve(null)

    const [details, reviews, players, extras] = await Promise.all([
      quiet(
        appId
          ? this.cached(`details:${appId}`, () => this.client.appDetails(appId)).then((d) =>
              parseAppDetails(d, appId)
            )
          : null
      ),
      quiet(
        appId
          ? this.cached(`reviews:${appId}`, () => this.client.reviews(appId)).then((d) =>
              parseReviews(d, appId)
            )
          : null
      ),
      quiet(
        appId
          ? this.cached(`players:${appId}`, () => this.client.players(appId)).then(parsePlayers)
          : null
      ),
      quiet(
        igdbId !== null ? this.cached(`igdb:${igdbId}`, () => this.deps.igdbExtras(igdbId)) : null
      )
    ])

    const steamLinks = appId ? [storePageUrl(appId), communityHubUrl(appId)] : []
    return {
      steamAppId: appId,
      store: storeInfo(details),
      reviews,
      playersOnline: players,
      metacritic: details?.metacritic?.score
        ? { score: details.metacritic.score, url: details.metacritic.url ?? null }
        : null,
      achievementsTotal: details?.achievements?.total ?? null,
      videos: [
        ...(appId ? steamVideos(details, appId) : []),
        ...youtubeVideos(extras?.videos ?? [])
      ],
      links: buildLinks(details?.website, [...steamLinks, ...(extras?.websites ?? [])]),
      steamKey: this.deps.steamCredentials() !== null
    }
  }

  async news(gameId: number): Promise<NewsItem[]> {
    return this.newsForApp(await this.requireAppId(gameId))
  }

  newsForApp(appId: string): Promise<NewsItem[]> {
    return this.cached(`news:${appId}`, () => this.client.news(appId)).then((data) =>
      parseNews(data, remoteImageUrl(steamHeaderUrl(appId)))
    )
  }

  async community(gameId: number, kind: CommunityKind): Promise<CommunityItem[]> {
    const appId = await this.requireAppId(gameId)
    const { apiKey } = this.requireKey()
    const data = await this.cached(`community:${appId}:${kind}`, () =>
      this.client.community(apiKey, appId, kind)
    ).catch((error: unknown) => {
      throw steamKeyError(error)
    })
    return parseCommunity(data)
  }

  /**
   * Achievement list with global rarity. The player's progress is added for games of
   * the Steam library (it is never cached: it changes after each session).
   */
  async achievements(gameId: number): Promise<AchievementsView> {
    const row = getGameRow(this.deps.db, gameId)
    const appId = await this.requireAppId(gameId)
    const { apiKey, steamId } = this.requireKey()
    const schema = await this.cached(`schema:${appId}`, () =>
      this.client.schema(apiKey, appId)
    ).catch((error: unknown) => {
      throw steamKeyError(error)
    })
    if (!schema.game?.availableGameStats?.achievements?.length) {
      return { total: 0, unlocked: null, items: [], note: null }
    }
    const global = await this.cached(`global:${appId}`, () =>
      this.client.globalPercentages(appId)
    ).catch(() => null)

    if (row.source !== 'steam') {
      return mergeAchievements(
        schema,
        null,
        global,
        'Progression affichée seulement pour les jeux de votre bibliothèque Steam.'
      )
    }
    let note: string | null = null
    const player = await this.client
      .playerAchievements(apiKey, steamId, appId)
      .catch((error: unknown) => {
        note =
          error instanceof AppError && error.code === 'AUTH'
            ? 'Progression indisponible : passez « Détails des jeux » en public sur votre profil Steam.'
            : 'Progression indisponible pour le moment.'
        return null
      })
    return mergeAchievements(schema, player, global, note)
  }
}
