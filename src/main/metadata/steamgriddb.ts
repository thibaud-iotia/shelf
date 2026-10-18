import { AppError } from '../../shared/errors'
import { requestJson, type FetchLike, type HttpOptions } from '../net/http'

// SteamGridDB: covers (grids 600x900), heroes and logos. https://www.steamgriddb.com/api/v2

const API = 'https://www.steamgriddb.com/api/v2'

export type ArtworkKind = 'grids' | 'heroes' | 'logos'

interface Envelope<T> {
  success?: boolean
  data?: T
  errors?: string[]
}

export interface Artwork {
  cover: string | null
  hero: string | null
  logo: string | null
}

/** Target game: a Steam app id when known (exact), otherwise a title search. */
export type SgdbTarget = { steamAppId: string } | { title: string }

export class SteamGridDbClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetch?: FetchLike
  ) {}

  private options(): HttpOptions {
    return { service: 'SteamGridDB', fetch: this.fetch }
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const data = await requestJson<Envelope<T>>(
        `${API}${path}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
        this.options()
      )
      return data.success === false ? null : (data.data ?? null)
    } catch (error) {
      if (error instanceof AppError && error.code === 'AUTH') {
        throw new AppError('AUTH', 'Clé API SteamGridDB refusée.')
      }
      // 404 = nothing for this game.
      if (error instanceof AppError && /HTTP 404/.test(error.message)) return null
      throw error
    }
  }

  async searchId(title: string): Promise<number | null> {
    const results = await this.get<{ id: number; name: string }[]>(
      `/search/autocomplete/${encodeURIComponent(title)}`
    )
    return results?.[0]?.id ?? null
  }

  private async first(kind: ArtworkKind, base: string, query = ''): Promise<string | null> {
    const images = await this.get<{ url: string }[]>(`/${kind}/${base}${query}`)
    return images?.[0]?.url ?? null
  }

  async artwork(target: SgdbTarget): Promise<Artwork> {
    let base: string
    if ('steamAppId' in target) {
      base = `steam/${encodeURIComponent(target.steamAppId)}`
    } else {
      const id = await this.searchId(target.title)
      if (id === null) return { cover: null, hero: null, logo: null }
      base = `game/${id}`
    }
    const [cover, hero, logo] = await Promise.all([
      this.first('grids', base, '?dimensions=600x900'),
      this.first('heroes', base),
      this.first('logos', base)
    ])
    return { cover, hero, logo }
  }

  async test(): Promise<void> {
    await this.get('/search/autocomplete/portal')
  }
}
