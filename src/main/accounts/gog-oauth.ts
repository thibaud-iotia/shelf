import { AppError } from '../../shared/errors'
import { requestJson, type HttpOptions } from '../net/http'
import type { AccountProvider, OwnedGame, ProviderDeps } from './types'

// GOG option B (unofficial, behind the `gogOAuthEnabled` flag): the OAuth flow of the
// GOG Galaxy client, as used by Heroic and lgogdownloader. Isolated in this module: if
// GOG changes it, only this provider fails.

export const GOG_CLIENT_ID = '46899977096215655'
const GOG_CLIENT_SECRET = '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9'
export const GOG_REDIRECT_URI = 'https://embed.gog.com/on_login_success?origin=client'

export const GOG_AUTH_URL =
  `https://auth.gog.com/auth?client_id=${GOG_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(GOG_REDIRECT_URI)}&response_type=code&layout=client2`

/** Extracts the authorization code from the final redirect of the login window. */
export function codeFromRedirect(url: string): string | null {
  if (!url.startsWith('https://embed.gog.com/on_login_success')) return null
  return new URL(url).searchParams.get('code')
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  user_id?: string
  error_description?: string
}

interface ProductsPage {
  totalPages?: number
  products?: { id: number; title: string; isGame?: boolean }[]
}

export function parseProducts(page: ProductsPage): OwnedGame[] {
  return (page.products ?? [])
    .filter((p) => p.isGame !== false)
    .map((p) => ({ source: 'gog' as const, sourceId: String(p.id), title: p.title }))
}

function options(deps: ProviderDeps): HttpOptions {
  return { service: 'GOG', fetch: deps.fetch }
}

async function token(params: Record<string, string>, deps: ProviderDeps) {
  const query = new URLSearchParams({
    client_id: GOG_CLIENT_ID,
    client_secret: GOG_CLIENT_SECRET,
    ...params
  })
  const data = await requestJson<TokenResponse>(
    `https://auth.gog.com/token?${query}`,
    {},
    options(deps)
  ).catch((error: unknown) => {
    if (error instanceof AppError && error.code === 'AUTH') {
      throw new AppError('AUTH', 'Session GOG expirée : reconnectez le compte.')
    }
    throw error
  })
  if (!data.access_token || !data.refresh_token) {
    throw new AppError('AUTH', `GOG : ${data.error_description ?? 'connexion refusée'}`)
  }
  return data as Required<Pick<TokenResponse, 'access_token' | 'refresh_token'>> & TokenResponse
}

export async function fetchGogOwned(accessToken: string, deps: ProviderDeps = {}) {
  const games: OwnedGame[] = []
  for (let page = 1; page <= 200; page++) {
    const data = await requestJson<ProductsPage>(
      `https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      options(deps)
    )
    games.push(...parseProducts(data))
    if (page >= (data.totalPages ?? 1)) break
  }
  return games
}

export interface GogOAuthDeps extends ProviderDeps {
  /** Opens the GOG login window and resolves with the authorization code. */
  login: () => Promise<string>
}

export function gogOAuthProvider(deps: GogOAuthDeps): AccountProvider<unknown> {
  return {
    kind: 'gog-oauth',
    source: 'gog',
    async connect() {
      const code = await deps.login()
      const tokens = await token(
        { grant_type: 'authorization_code', code, redirect_uri: GOG_REDIRECT_URI },
        deps
      )
      const user = await requestJson<{ username?: string; userId?: string }>(
        'https://embed.gog.com/userData.json',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        options(deps)
      )
      return {
        displayName: user.username ?? 'Compte GOG',
        externalUserId: user.userId ?? tokens.user_id ?? 'gog',
        secret: tokens.refresh_token
      }
    },
    async fetchOwned(_account, refreshToken) {
      if (!refreshToken) throw new AppError('AUTH', 'Session GOG absente : reconnectez le compte.')
      const tokens = await token({ grant_type: 'refresh_token', refresh_token: refreshToken }, deps)
      return { games: await fetchGogOwned(tokens.access_token, deps), secret: tokens.refresh_token }
    }
  }
}
