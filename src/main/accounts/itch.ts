import { AppError } from '../../shared/errors'
import { requestJson, type HttpOptions } from '../net/http'
import type { AccountProvider, OwnedGame, ProviderDeps } from './types'

const API = 'https://api.itch.io'
const MAX_PAGES = 100

interface OwnedKeysPage {
  owned_keys?: {
    game_id?: number
    game?: { id?: number; title?: string; classification?: string }
  }[]
  per_page?: number
  page?: number
  errors?: string[]
}

export function parseOwnedKeys(page: OwnedKeysPage): OwnedGame[] {
  if (page.errors?.length) throw new AppError('AUTH', `itch.io : ${page.errors.join(', ')}`)
  return (page.owned_keys ?? []).flatMap((key) => {
    const id = key.game?.id ?? key.game_id
    const title = key.game?.title
    // Owned keys also cover soundtracks, books, tools…
    if (!id || !title) return []
    if (key.game?.classification && key.game.classification !== 'game') return []
    return [{ source: 'itch' as const, sourceId: String(id), title }]
  })
}

function options(deps: ProviderDeps): HttpOptions {
  return { service: 'itch.io', fetch: deps.fetch }
}

function headers(apiKey: string): RequestInit {
  return { headers: { Authorization: `Bearer ${apiKey}` } }
}

async function profile(apiKey: string, deps: ProviderDeps) {
  const data = await requestJson<{
    user?: { id: number; username: string; display_name?: string }
    errors?: string[]
  }>(`${API}/profile`, headers(apiKey), options(deps)).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'AUTH') {
      throw new AppError(
        'AUTH',
        'Clé API itch.io refusée. Créez-en une dans Paramètres › Clés API.'
      )
    }
    throw error
  })
  if (!data.user)
    throw new AppError('AUTH', `itch.io : ${data.errors?.join(', ') ?? 'clé invalide'}`)
  return data.user
}

export async function fetchItchOwned(
  apiKey: string,
  deps: ProviderDeps = {}
): Promise<OwnedGame[]> {
  const games = new Map<string, OwnedGame>()
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await requestJson<OwnedKeysPage>(
      `${API}/profile/owned-keys?page=${page}`,
      headers(apiKey),
      options(deps)
    )
    const found = parseOwnedKeys(data)
    for (const game of found) games.set(game.sourceId, game)
    const perPage = data.per_page ?? 50
    if ((data.owned_keys?.length ?? 0) < perPage) break
  }
  return [...games.values()]
}

export function itchProvider(deps: ProviderDeps = {}): AccountProvider<{ apiKey: string }> {
  return {
    kind: 'itch',
    source: 'itch',
    async connect({ apiKey }) {
      const key = apiKey?.trim()
      if (!key) throw new AppError('VALIDATION', 'Indiquez votre clé API itch.io.')
      const user = await profile(key, deps)
      return {
        displayName: user.display_name || user.username,
        externalUserId: String(user.id),
        secret: key
      }
    },
    async fetchOwned(_account, secret) {
      if (!secret) throw new AppError('AUTH', 'Clé API itch.io manquante : reconnectez le compte.')
      return { games: await fetchItchOwned(secret, deps) }
    }
  }
}
