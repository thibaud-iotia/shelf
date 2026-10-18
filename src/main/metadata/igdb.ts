import { AppError } from '../../shared/errors'
import { requestJson, type FetchLike, type HttpOptions } from '../net/http'

// IGDB (Twitch client-credentials). https://api-docs.igdb.com

const FIELDS = [
  'name',
  'summary',
  'first_release_date',
  'genres.name',
  'cover.image_id',
  'screenshots.image_id',
  'artworks.image_id',
  'involved_companies.developer',
  'involved_companies.company.name'
].join(',')

export interface IgdbGame {
  id: number
  name: string
  summary?: string
  first_release_date?: number
  genres?: { name: string }[]
  cover?: { image_id: string }
  screenshots?: { image_id: string }[]
  artworks?: { image_id: string }[]
  involved_companies?: { developer?: boolean; company?: { name?: string } }[]
}

export interface GameMetadata {
  igdbId: number
  title: string
  description: string | null
  releaseDate: string | null
  year: number | null
  genres: string[]
  developer: string | null
  coverImageId: string | null
  heroImageId: string | null
  screenshotIds: string[]
}

export type IgdbImageSize = 'cover_small' | 'cover_big' | 'screenshot_big' | '1080p'

export function igdbImageUrl(imageId: string, size: IgdbImageSize): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`
}

export function toMetadata(game: IgdbGame): GameMetadata {
  const date = game.first_release_date
    ? new Date(game.first_release_date * 1000).toISOString().slice(0, 10)
    : null
  const developer =
    game.involved_companies?.find((c) => c.developer && c.company?.name)?.company?.name ??
    game.involved_companies?.find((c) => c.company?.name)?.company?.name ??
    null
  return {
    igdbId: game.id,
    title: game.name,
    description: game.summary ?? null,
    releaseDate: date,
    year: date ? Number(date.slice(0, 4)) : null,
    genres: (game.genres ?? []).map((g) => g.name),
    developer,
    coverImageId: game.cover?.image_id ?? null,
    heroImageId: game.artworks?.[0]?.image_id ?? game.screenshots?.[0]?.image_id ?? null,
    screenshotIds: (game.screenshots ?? []).slice(0, 3).map((s) => s.image_id)
  }
}

/** Apicalypse string literal: quotes and backslashes escaped. */
export function apicalypseString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export class IgdbClient {
  private token: { value: string; expiresAt: number } | null = null

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetch?: FetchLike,
    private readonly now: () => number = Date.now
  ) {}

  private options(service = 'IGDB'): HttpOptions {
    return { service, fetch: this.fetch }
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value
    const query = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials'
    })
    const data = await requestJson<{ access_token?: string; expires_in?: number }>(
      `https://id.twitch.tv/oauth2/token?${query}`,
      { method: 'POST' },
      this.options('Twitch')
    ).catch((error: unknown) => {
      if (error instanceof AppError && (error.code === 'AUTH' || /HTTP 400/.test(error.message))) {
        throw new AppError('AUTH', 'Client ID ou secret IGDB (Twitch) refusé.')
      }
      throw error
    })
    if (!data.access_token) throw new AppError('AUTH', 'Twitch n’a pas délivré de jeton IGDB.')
    this.token = {
      value: data.access_token,
      expiresAt: this.now() + (data.expires_in ?? 3600) * 1000
    }
    return this.token.value
  }

  private async query(body: string): Promise<IgdbGame[]> {
    const token = await this.accessToken()
    return requestJson<IgdbGame[]>(
      'https://api.igdb.com/v4/games',
      {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain'
        },
        body
      },
      this.options()
    )
  }

  async search(title: string, limit = 6): Promise<GameMetadata[]> {
    const games = await this.query(
      `search ${apicalypseString(title)}; fields ${FIELDS}; where version_parent = null; limit ${limit};`
    )
    return games.map(toMetadata)
  }

  async byId(id: number): Promise<GameMetadata | null> {
    const [game] = await this.query(`fields ${FIELDS}; where id = ${Math.trunc(id)}; limit 1;`)
    return game ? toMetadata(game) : null
  }

  /** Checks the credentials (token + one tiny query). */
  async test(): Promise<void> {
    await this.query('fields name; limit 1;')
  }
}
