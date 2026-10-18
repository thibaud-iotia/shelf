import { AppError } from '../../shared/errors'

/**
 * The only hosts Shelf talks to (PLAN: Steam Web API, IGDB/Twitch, SteamGridDB, itch.io,
 * GOG option B). Every outgoing request goes through this module.
 */
export const ALLOWED_HOSTS = new Set([
  'api.steampowered.com',
  'id.twitch.tv',
  'api.igdb.com',
  'images.igdb.com',
  'www.steamgriddb.com',
  'cdn2.steamgriddb.com',
  'api.itch.io',
  'auth.gog.com',
  'embed.gog.com'
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
