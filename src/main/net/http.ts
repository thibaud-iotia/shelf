import { AppError } from '../../shared/errors'

/**
 * Image CDNs the game page may show (Steam store/community, YouTube thumbnails, IGDB,
 * SteamGridDB). The renderer reaches them only through `shelf-media://remote/…`.
 */
export const IMAGE_HOSTS = new Set([
  'images.igdb.com',
  'cdn2.steamgriddb.com',
  'shared.akamai.steamstatic.com',
  'shared.fastly.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'cdn.fastly.steamstatic.com',
  'clan.akamai.steamstatic.com',
  'clan.fastly.steamstatic.com',
  'steamcdn-a.akamaihd.net',
  'images.steamusercontent.com',
  'steamuserimages-a.akamaihd.net',
  'i.ytimg.com',
  // Store (CheapShark thumbnails and store icons, Epic and GOG artwork).
  'www.cheapshark.com',
  'cdn1.epicgames.com',
  'images.gog-statics.com'
])

/**
 * The only hosts Shelf talks to (PLAN: Steam Web API and store, IGDB/Twitch, SteamGridDB,
 * itch.io, GOG option B, CheapShark and the GOG catalog for the store, plus the image CDNs
 * above). Every outgoing request goes through this module.
 */
export const ALLOWED_HOSTS = new Set([
  'api.steampowered.com',
  'store.steampowered.com',
  'id.twitch.tv',
  'api.igdb.com',
  'www.steamgriddb.com',
  'api.itch.io',
  'auth.gog.com',
  'embed.gog.com',
  // Store: price comparison (CheapShark) and GOG product lookup (id, price in euros).
  'catalog.gog.com',
  ...IMAGE_HOSTS
])

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface HttpOptions {
  /** Human name used in error messages ("Steam", "IGDB"…). */
  service: string
  fetch?: FetchLike
  timeoutMs?: number
}

export function assertAllowed(url: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new AppError('VALIDATION', `URL invalide : ${url}`)
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new AppError('FORBIDDEN', `Accès réseau refusé : ${parsed.hostname}`)
  }
  return parsed
}

async function send(url: string, init: RequestInit, options: HttpOptions): Promise<Response> {
  assertAllowed(url)
  const fetchImpl = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(options.timeoutMs ?? 20_000)
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new AppError('NETWORK', `Impossible de joindre ${options.service} : ${reason}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      'AUTH',
      `${options.service} a refusé les identifiants (HTTP ${response.status}).`
    )
  }
  if (response.status === 429) {
    throw new AppError(
      'RATE_LIMITED',
      `Trop de requêtes vers ${options.service} : réessayez dans quelques minutes.`
    )
  }
  if (!response.ok) {
    throw new AppError('NETWORK', `${options.service} a répondu HTTP ${response.status}.`)
  }
  return response
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: HttpOptions
): Promise<T> {
  const response = await send(url, init, options)
  try {
    return (await response.json()) as T
  } catch {
    throw new AppError('NETWORK', `Réponse illisible de ${options.service}.`)
  }
}

export async function requestBinary(
  url: string,
  options: HttpOptions
): Promise<{ data: Buffer; contentType: string | null }> {
  const response = await send(url, {}, options)
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')
  }
}
