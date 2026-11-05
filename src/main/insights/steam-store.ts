import { AppError } from '../../shared/errors'
import type {
  AboutBlock,
  Achievement,
  AchievementsView,
  CommunityItem,
  CommunityKind,
  GameVideo,
  NewsItem,
  Requirement,
  StoreInfo,
  ReviewSummary
} from '../../shared/models'
import { remoteImageUrl } from '../media/remote'
import { requestJson, type FetchLike, type HttpOptions } from '../net/http'
import { normalizeTitle } from '../games/titles'

// Public Steam endpoints behind the game page. Formats checked against the live
// services on 2026-11-04 (fixtures: tests/fixtures/api/steam-*.json).

const API = 'https://api.steampowered.com'
const STORE = 'https://store.steampowered.com'
const VIDEO_CDN = 'https://video.akamai.steamstatic.com/store_trailers'
const CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images'

export const storePageUrl = (appId: string) => `${STORE}/app/${appId}/`
export const communityHubUrl = (appId: string) => `https://steamcommunity.com/app/${appId}`
export const reviewsPageUrl = (appId: string) => `https://steamcommunity.com/app/${appId}/reviews/`
const sharedFileUrl = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`

// --- Store search (appid of a non-Steam game) ---

export interface StoreSearchResponse {
  items?: { type?: string; id?: number; name?: string }[]
}

/** Appid of the first app whose normalized name equals the title, or null. */
export function matchStoreSearch(data: StoreSearchResponse, title: string): string | null {
  const wanted = normalizeTitle(title)
  if (!wanted) return null
  const hit = (data.items ?? []).find(
    (item) => item.type === 'app' && item.id && item.name && normalizeTitle(item.name) === wanted
  )
  return hit?.id ? String(hit.id) : null
}

// --- App details (videos, website, Metacritic, achievement count) ---

export interface AppDetailsData {
  name?: string
  website?: string | null
  metacritic?: { score?: number; url?: string }
  achievements?: { total?: number }
  movies?: { id: number; name?: string; thumbnail?: string; highlight?: boolean }[]
  short_description?: string
  about_the_game?: string
  is_free?: boolean
  controller_support?: string
  supported_languages?: string
  pc_requirements?: { minimum?: string; recommended?: string } | unknown[]
  developers?: string[]
  publishers?: string[]
  price_overview?: { final_formatted?: string; discount_percent?: number }
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean }
  categories?: { id: number; description?: string }[]
  genres?: { id: string; description?: string }[]
  release_date?: { coming_soon?: boolean; date?: string }
  screenshots?: { id: number; path_thumbnail?: string; path_full?: string }[]
}

export type AppDetailsResponse = Record<string, { success?: boolean; data?: AppDetailsData }>

export function parseAppDetails(data: AppDetailsResponse, appId: string): AppDetailsData | null {
  const entry = data[appId]
  return entry?.success && entry.data ? entry.data : null
}

/** Plain text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function htmlText(html: string): string {
  return html
    .replace(/<\/?(?:strong|b|i|em|u|span|a)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim()
}

const ABOUT_TOKEN =
  /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<img[^>]*\bsrc=["']([^"']+)["'][^>]*>|<video[\s\S]*?<\/video>|<br\s*\/?>|<\/?(?:p|ul|ol|div)[^>]*>|<li[^>]*>/gi

/**
 * "About this game" as headings, paragraphs and images (proxied, allowed CDNs only).
 * Steam's looping videos are dropped: they are decoration, the trailers have their tab.
 */
export function storeAbout(html: string | undefined): AboutBlock[] {
  if (!html) return []
  const blocks: AboutBlock[] = []
  let text = ''
  const flush = () => {
    const clean = htmlText(text)
    if (clean && clean !== '•') blocks.push({ kind: 'text', text: clean })
    text = ''
  }
  let last = 0
  for (const match of html.matchAll(ABOUT_TOKEN)) {
    text += html.slice(last, match.index)
    last = match.index + match[0].length
    const [token, heading, image] = match
    if (heading !== undefined) {
      flush()
      const clean = htmlText(heading)
      if (clean) blocks.push({ kind: 'heading', text: clean })
    } else if (image !== undefined) {
      flush()
      const url = remoteImageUrl(image)
      if (url) blocks.push({ kind: 'image', url })
    } else if (/^<li/i.test(token)) {
      flush()
      text = '• '
    } else {
      flush()
    }
  }
  text += html.slice(last)
  flush()
  return blocks
}

/** "Label : value" lines of a Steam requirements block. */
export function parseRequirements(html: string | undefined): Requirement[] {
  if (!html) return []
  return [...html.matchAll(/<li[^>]*>([\s\S]*?)(?=<li|<\/ul>|$)/gi)].flatMap(([, item]) => {
    const line = htmlText(item!)
    const colon = line.indexOf(':')
    if (colon <= 0) return line ? [{ label: '', value: line }] : []
    const label = line
      .slice(0, colon)
      .replace(/\s*\*$/, '')
      .trim()
    const value = line.slice(colon + 1).trim()
    return value ? [{ label, value }] : []
  })
}

/** Languages; a trailing `<strong>*</strong>` marks full audio support. */
export function parseLanguages(html: string | undefined): { name: string; audio: boolean }[] {
  if (!html) return []
  const list = html.split(/<br\s*\/?>/i)[0]!
  return list.split(',').flatMap((part) => {
    const audio = /<strong>\s*\*\s*<\/strong>|\*/.test(part)
    const name = htmlText(part.replace(/\*/g, ''))
    return name ? [{ name, audio }] : []
  })
}

const PLATFORMS = ['windows', 'mac', 'linux'] as const

export function storeInfo(details: AppDetailsData | null): StoreInfo | null {
  if (!details) return null
  const requirements = Array.isArray(details.pc_requirements) ? {} : (details.pc_requirements ?? {})
  const names = (items: { description?: string }[] | undefined) =>
    (items ?? []).map((i) => i.description?.trim() ?? '').filter(Boolean)
  const controller = details.controller_support
  return {
    shortDescription: details.short_description ? htmlText(details.short_description) : null,
    about: storeAbout(details.about_the_game),
    genres: names(details.genres),
    features: names(details.categories),
    developers: details.developers ?? [],
    publishers: details.publishers ?? [],
    releaseDate: details.release_date?.date?.trim() || null,
    comingSoon: details.release_date?.coming_soon ?? false,
    platforms: PLATFORMS.filter((p) => details.platforms?.[p]),
    price: details.is_free
      ? 'Gratuit'
      : details.price_overview?.final_formatted?.replace(/(\d)€/, '$1 €') || null,
    discountPercent: details.price_overview?.discount_percent ?? 0,
    controller: controller === 'full' || controller === 'partial' ? controller : null,
    languages: parseLanguages(details.supported_languages),
    requirements: {
      minimum: parseRequirements(requirements.minimum),
      recommended: parseRequirements(requirements.recommended)
    },
    screenshots: (details.screenshots ?? []).flatMap((shot) => {
      const thumbUrl = remoteImageUrl(shot.path_thumbnail)
      const fullUrl = remoteImageUrl(shot.path_full)
      return thumbUrl && fullUrl ? [{ thumbUrl, fullUrl }] : []
    })
  }
}

/**
 * Steam trailers. `appdetails` only lists DASH/HLS manifests now; the classic mp4 files
 * are still served from the trailer CDN by movie id (checked 2026-11-04).
 */
export function steamVideos(details: AppDetailsData | null, appId: string): GameVideo[] {
  return (details?.movies ?? []).map((movie) => ({
    id: `steam-${movie.id}`,
    title: movie.name?.trim() || 'Bande-annonce',
    kind: 'steam' as const,
    posterUrl: remoteImageUrl(movie.thumbnail),
    sources: [`${VIDEO_CDN}/${movie.id}/movie_max.mp4`, `${VIDEO_CDN}/${movie.id}/movie480.mp4`],
    pageUrl: storePageUrl(appId)
  }))
}

// --- News ---

export interface NewsResponse {
  appnews?: {
    newsitems?: {
      gid: string
      title?: string
      url?: string
      author?: string
      contents?: string
      feedlabel?: string
      feedname?: string
      feed_type?: number
      date?: number
    }[]
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'"
}

/** Plain text of a news body (BBCode or HTML), cut to `max` characters. */
export function newsSummary(contents: string, max = 280): string {
  const text = contents
    .replace(/\[(img|previewyoutube|video)[^\]]*\][\s\S]*?\[\/\1\]/gi, ' ')
    .replace(/\[\/?[a-z0-9*]+(?:[= ][^\]]*)?\]/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
    .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

/** First image of a news body, proxied; null when none or not on an allowed CDN. */
export function newsImage(contents: string): string | null {
  const match =
    /\[img(?:\s+src=["']?([^\]"'\s]+)["']?)?\]([^[]*)\[\/img\]/i.exec(contents) ??
    /<img[^>]+src=["']([^"']+)["']/i.exec(contents)
  const raw = (match?.[1] || match?.[2] || '').trim()
  if (!raw) return null
  return remoteImageUrl(raw.replace('{STEAM_CLAN_IMAGE}', CLAN_IMAGES))
}

export function parseNews(data: NewsResponse): NewsItem[] {
  return (data.appnews?.newsitems ?? []).map((item) => {
    const contents = item.contents ?? ''
    const official = item.feedname === 'steam_community_announcements'
    return {
      id: item.gid,
      title: item.title?.trim() || 'Sans titre',
      url: item.url ?? '',
      author: item.author?.trim() || null,
      date: (item.date ?? 0) * 1000,
      feed: official ? 'Annonce officielle' : item.feedlabel?.trim() || item.feedname || 'Presse',
      official,
      summary: newsSummary(contents),
      imageUrl: newsImage(contents)
    }
  })
}

// --- Reviews summary and players online ---

export interface StoreBrowseResponse {
  response?: {
    store_items?: {
      appid?: number
      success?: number
      reviews?: {
        summary_filtered?: {
          review_count?: number
          percent_positive?: number
          review_score?: number
          review_score_label?: string
        }
      }
    }[]
  }
}

export function parseReviews(data: StoreBrowseResponse, appId: string): ReviewSummary | null {
  const item = data.response?.store_items?.find((i) => String(i.appid) === appId)
  const summary = item?.reviews?.summary_filtered
  if (!summary?.review_count) return null
  return {
    label: summary.review_score_label ?? '',
    score: summary.review_score ?? 0,
    percentPositive: summary.percent_positive ?? 0,
    count: summary.review_count,
    url: reviewsPageUrl(appId)
  }
}

export function parsePlayers(data: { response?: { player_count?: number; result?: number } }) {
  return data.response?.result === 1 ? (data.response.player_count ?? null) : null
}

// --- Community shares (IPublishedFileService/QueryFiles, needs a Web API key) ---

/** EPublishedFileInfoMatchingFileType values used by QueryFiles. */
export const COMMUNITY_FILE_TYPES: Record<CommunityKind, number> = {
  artwork: 2,
  screenshots: 4,
  guides: 10
}

export interface QueryFilesResponse {
  response?: {
    publishedfiledetails?: {
      publishedfileid: string
      result?: number
      title?: string
      short_description?: string
      file_description?: string
      preview_url?: string
      time_created?: number
      vote_data?: { votes_up?: number }
    }[]
  }
}

export function parseCommunity(data: QueryFilesResponse): CommunityItem[] {
  return (data.response?.publishedfiledetails ?? [])
    .filter((file) => file.result === undefined || file.result === 1)
    .map((file) => {
      const description = (file.short_description ?? file.file_description ?? '').trim()
      return {
        id: file.publishedfileid,
        title: file.title?.trim() || 'Sans titre',
        description: description ? newsSummary(description, 160) : null,
        previewUrl: remoteImageUrl(file.preview_url),
        url: sharedFileUrl(file.publishedfileid),
        votesUp: file.vote_data?.votes_up ?? 0,
        createdAt: (file.time_created ?? 0) * 1000
      }
    })
}

// --- Achievements ---

export interface SchemaResponse {
  game?: {
    availableGameStats?: {
      achievements?: {
        name: string
        displayName?: string
        description?: string
        hidden?: number
        icon?: string
        icongray?: string
      }[]
    }
  }
}

export interface PlayerAchievementsResponse {
  playerstats?: {
    success?: boolean
    achievements?: { apiname: string; achieved?: number; unlocktime?: number }[]
  }
}

export interface GlobalPercentagesResponse {
  achievementpercentages?: { achievements?: { name: string; percent?: number | string }[] }
}

/**
 * Schema + optional player progress + optional global rarity. Unlocked first (most
 * recent first), then locked ones from the most to the least common.
 */
export function mergeAchievements(
  schema: SchemaResponse,
  player: PlayerAchievementsResponse | null,
  global: GlobalPercentagesResponse | null,
  note: string | null
): AchievementsView {
  const defs = schema.game?.availableGameStats?.achievements ?? []
  const progress = new Map(
    (player?.playerstats?.achievements ?? []).map((a) => [a.apiname, a] as const)
  )
  const percents = new Map(
    (global?.achievementpercentages?.achievements ?? []).map(
      (a) => [a.name, Number(a.percent)] as const
    )
  )
  const known = player?.playerstats?.success !== false && !!player?.playerstats?.achievements
  const items: Achievement[] = defs.map((def) => {
    const mine = progress.get(def.name)
    const unlocked = known ? mine?.achieved === 1 : null
    const percent = percents.get(def.name)
    return {
      id: def.name,
      name: def.displayName?.trim() || def.name,
      description: def.description?.trim() || null,
      iconUrl: remoteImageUrl(unlocked === false ? (def.icongray ?? def.icon) : def.icon),
      hidden: def.hidden === 1,
      unlocked,
      unlockedAt: unlocked && mine?.unlocktime ? mine.unlocktime * 1000 : null,
      percent: percent !== undefined && Number.isFinite(percent) ? percent : null
    }
  })
  items.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1
    if (a.unlocked) return (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)
    return (b.percent ?? -1) - (a.percent ?? -1)
  })
  return {
    total: items.length,
    unlocked: known ? items.filter((a) => a.unlocked).length : null,
    items,
    note: known ? null : note
  }
}

// --- Client ---

/** Thin client: one method per endpoint, raw responses, errors from net/http.ts. */
export class SteamStoreClient {
  constructor(private readonly fetch?: FetchLike) {}

  private get<T>(url: string, service = 'Steam'): Promise<T> {
    const options: HttpOptions = { service, fetch: this.fetch }
    return requestJson<T>(url, {}, options)
  }

  search(title: string): Promise<StoreSearchResponse> {
    const query = new URLSearchParams({ term: title, l: 'french', cc: 'FR' })
    return this.get(`${STORE}/api/storesearch/?${query}`, 'la boutique Steam')
  }

  appDetails(appId: string): Promise<AppDetailsResponse> {
    const query = new URLSearchParams({ appids: appId, l: 'french', cc: 'FR' })
    return this.get(`${STORE}/api/appdetails?${query}`, 'la boutique Steam')
  }

  news(appId: string, count = 12): Promise<NewsResponse> {
    const query = new URLSearchParams({
      appid: appId,
      count: String(count),
      maxlength: '0',
      format: 'json'
    })
    return this.get(`${API}/ISteamNews/GetNewsForApp/v2/?${query}`)
  }

  reviews(appId: string): Promise<StoreBrowseResponse> {
    const input = {
      ids: [{ appid: Number(appId) }],
      context: { language: 'french', country_code: 'FR' },
      data_request: { include_reviews: true }
    }
    const query = new URLSearchParams({ input_json: JSON.stringify(input) })
    return this.get(`${API}/IStoreBrowseService/GetItems/v1/?${query}`)
  }

  players(appId: string) {
    return this.get<{ response?: { player_count?: number; result?: number } }>(
      `${API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(appId)}`
    )
  }

  community(apiKey: string, appId: string, kind: CommunityKind): Promise<QueryFilesResponse> {
    const query = new URLSearchParams({
      key: apiKey,
      appid: appId,
      filetype: String(COMMUNITY_FILE_TYPES[kind]),
      query_type: '3', // RankedByTrend
      days: '30',
      numperpage: '24',
      return_previews: 'true',
      return_vote_data: 'true',
      return_short_description: 'true'
    })
    return this.get(`${API}/IPublishedFileService/QueryFiles/v1/?${query}`)
  }

  schema(apiKey: string, appId: string): Promise<SchemaResponse> {
    const query = new URLSearchParams({ key: apiKey, appid: appId, l: 'french' })
    return this.get(`${API}/ISteamUserStats/GetSchemaForGame/v2/?${query}`)
  }

  playerAchievements(
    apiKey: string,
    steamId: string,
    appId: string
  ): Promise<PlayerAchievementsResponse> {
    const query = new URLSearchParams({ key: apiKey, steamid: steamId, appid: appId })
    return this.get(`${API}/ISteamUserStats/GetPlayerAchievements/v1/?${query}`)
  }

  globalPercentages(appId: string): Promise<GlobalPercentagesResponse> {
    return this.get(
      `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${encodeURIComponent(appId)}`
    )
  }
}

/** Clear message for a refused Steam key (shared by the keyed endpoints). */
export function steamKeyError(error: unknown): unknown {
  if (error instanceof AppError && error.code === 'AUTH') {
    return new AppError(
      'AUTH',
      'Steam refuse la clé du compte (ou le profil est privé). Vérifiez Réglages › Comptes.'
    )
  }
  return error
}
