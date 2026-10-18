import { AppError } from '../../shared/errors'
import { requestJson, type HttpOptions } from '../net/http'
import type { AccountProvider, OwnedGame, ProviderDeps } from './types'

const API = 'https://api.steampowered.com'

export type SteamIdInput = { kind: 'id64'; value: string } | { kind: 'vanity'; value: string }

/** Accepts a SteamID64, a profile URL (/profiles/… or /id/…) or a custom URL name. */
export function parseSteamIdInput(raw: string): SteamIdInput {
  const input = raw.trim().replace(/\/+$/, '')
  if (!input) throw new AppError('VALIDATION', 'Indiquez votre SteamID64 ou l’URL de votre profil.')
  const profiles = /steamcommunity\.com\/profiles\/(\d{17})$/i.exec(input)
  if (profiles) return { kind: 'id64', value: profiles[1]! }
  const vanity = /steamcommunity\.com\/id\/([^/?#]+)$/i.exec(input)
  if (vanity) return { kind: 'vanity', value: decodeURIComponent(vanity[1]!) }
  if (/^7656\d{13}$/.test(input)) return { kind: 'id64', value: input }
  if (/^[\w-]{2,32}$/.test(input)) return { kind: 'vanity', value: input }
  throw new AppError('VALIDATION', 'SteamID64 ou URL de profil Steam non reconnu.')
}

interface OwnedGamesResponse {
  response?: {
    game_count?: number
    games?: { appid: number; name?: string; playtime_forever?: number }[]
  }
}

/** GetOwnedGames answers `{ response: {} }` when the profile or its game details are private. */
export function parseOwnedGames(data: OwnedGamesResponse): OwnedGame[] {
  const games = data.response?.games
  if (!games) {
    throw new AppError(
      'AUTH',
      'Steam ne renvoie aucun jeu : passez « Détails des jeux » en public dans les paramètres de confidentialité de votre profil.'
    )
  }
  return games.map((g) => ({
    source: 'steam' as const,
    sourceId: String(g.appid),
    title: g.name ?? `App ${g.appid}`,
    playtimeMin: g.playtime_forever ?? 0
  }))
}

function http(deps: ProviderDeps): HttpOptions {
  return { service: 'Steam', fetch: deps.fetch }
}

async function withKeyMessage<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof AppError && error.code === 'AUTH' && /HTTP/.test(error.message)) {
      throw new AppError(
        'AUTH',
        'Clé API Steam refusée. Vérifiez-la sur steamcommunity.com/dev/apikey.'
      )
    }
    throw error
  }
}

export async function resolveSteamId(
  apiKey: string,
  input: SteamIdInput,
  deps: ProviderDeps = {}
): Promise<string> {
  if (input.kind === 'id64') return input.value
  const url = `${API}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(input.value)}`
  const data = await withKeyMessage(
    requestJson<{ response?: { success?: number; steamid?: string } }>(url, {}, http(deps))
  )
  if (data.response?.success !== 1 || !data.response.steamid) {
    throw new AppError('VALIDATION', `Aucun profil Steam ne correspond à « ${input.value} ».`)
  }
  return data.response.steamid
}

export async function fetchSteamOwned(
  apiKey: string,
  steamId: string,
  deps: ProviderDeps = {}
): Promise<OwnedGame[]> {
  const url = `${API}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
  return parseOwnedGames(await withKeyMessage(requestJson<OwnedGamesResponse>(url, {}, http(deps))))
}

async function personaName(apiKey: string, steamId: string, deps: ProviderDeps): Promise<string> {
  const url = `${API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`
  const data = await withKeyMessage(
    requestJson<{ response?: { players?: { personaname?: string }[] } }>(url, {}, http(deps))
  )
  return data.response?.players?.[0]?.personaname ?? steamId
}

export function steamProvider(
  deps: ProviderDeps = {}
): AccountProvider<{ apiKey: string; steamId: string }> {
  return {
    kind: 'steam',
    source: 'steam',
    async connect({ apiKey, steamId }) {
      const key = apiKey?.trim()
      if (!key || !/^[0-9A-F]{32}$/i.test(key)) {
        throw new AppError('VALIDATION', 'La clé API Steam fait 32 caractères hexadécimaux.')
      }
      const id = await resolveSteamId(key, parseSteamIdInput(steamId ?? ''), deps)
      // Fails early (private profile, bad key) instead of at the first sync.
      await fetchSteamOwned(key, id, deps)
      return { displayName: await personaName(key, id, deps), externalUserId: id, secret: key }
    },
    async fetchOwned(account, secret) {
      if (!secret) throw new AppError('AUTH', 'Clé API Steam manquante : reconnectez le compte.')
      return { games: await fetchSteamOwned(secret, account.externalUserId, deps) }
    }
  }
}
