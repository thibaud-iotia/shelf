import { eq, isNull } from 'drizzle-orm'
import { AppError } from '../../shared/errors'
import type {
  ApiKeyService,
  ApiKeysInput,
  ConnectionTest,
  MetadataMatch
} from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { games } from '../db/schema'
import { getGameRow, type GameRow } from '../games/repository'
import { normalizeTitle } from '../games/titles'
import type { MediaCache } from '../media/cache'
import { mediaUrl } from '../media/urls'
import type { FetchLike } from '../net/http'
import type { SecretStore } from '../secrets/store'
import { IgdbClient, igdbImageUrl, type GameMetadata } from './igdb'
import { SteamGridDbClient, type SgdbTarget } from './steamgriddb'

export const SECRET_REFS = {
  igdbClientId: 'igdb.clientId',
  igdbClientSecret: 'igdb.clientSecret',
  steamGridDbKey: 'steamgriddb.apiKey'
} as const

export interface EnrichTarget {
  id: number
  /** number = chosen match, null = "aucun", undefined = pick automatically. */
  igdbId?: number | null
}

/** IGDB metadata + SteamGridDB artwork, cached locally. */
export class MetadataService {
  private igdbClient: IgdbClient | null = null

  constructor(
    private readonly db: ShelfDatabase,
    private readonly secrets: SecretStore,
    private readonly cache: MediaCache,
    private readonly fetch?: FetchLike
  ) {}

  igdbConfigured(): boolean {
    return (
      this.secrets.has(SECRET_REFS.igdbClientId) && this.secrets.has(SECRET_REFS.igdbClientSecret)
    )
  }

  steamGridDbConfigured(): boolean {
    return this.secrets.has(SECRET_REFS.steamGridDbKey)
  }

  setKeys(input: ApiKeysInput): void {
    for (const [field, ref] of Object.entries(SECRET_REFS) as [keyof ApiKeysInput, string][]) {
      const value = input[field]
      if (typeof value === 'string' && value.trim()) this.secrets.set(ref, value.trim())
    }
    this.igdbClient = null
  }

  clearKeys(service: ApiKeyService): void {
    if (service === 'igdb') {
      this.secrets.delete(SECRET_REFS.igdbClientId)
      this.secrets.delete(SECRET_REFS.igdbClientSecret)
      this.igdbClient = null
    } else {
      this.secrets.delete(SECRET_REFS.steamGridDbKey)
    }
  }

  private igdb(): IgdbClient {
    const id = this.secrets.get(SECRET_REFS.igdbClientId)
    const secret = this.secrets.get(SECRET_REFS.igdbClientSecret)
    if (!id || !secret) {
      throw new AppError('VALIDATION', 'Configurez IGDB dans Réglages › Métadonnées.')
    }
    this.igdbClient ??= new IgdbClient(id, secret, this.fetch)
    return this.igdbClient
  }

  private sgdb(): SteamGridDbClient | null {
    const key = this.secrets.get(SECRET_REFS.steamGridDbKey)
    return key ? new SteamGridDbClient(key, this.fetch) : null
  }

  async test(service: ApiKeyService): Promise<ConnectionTest> {
    try {
      if (service === 'igdb') {
        this.igdbClient = null
        await this.igdb().test()
        return { ok: true, message: '✓ connecté' }
      }
      const client = this.sgdb()
      if (!client) return { ok: false, message: 'Clé API manquante.' }
      await client.test()
      return { ok: true, message: '✓ connecté' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async search(title: string): Promise<MetadataMatch[]> {
    const query = title.trim()
    if (!query) return []
    const results = await this.igdb().search(query)
    return Promise.all(
      results.map(async (m) => ({
        igdbId: m.igdbId,
        name: m.title,
        year: m.year,
        developer: m.developer,
        thumbUrl: m.coverImageId
          ? await this.cache
              .downloadOnce(
                igdbImageUrl(m.coverImageId, 'cover_small'),
                `igdb-thumb-${m.coverImageId}.jpg`
              )
              .then(mediaUrl, () => null)
          : null
      }))
    )
  }

  private async artworkFor(row: GameRow, meta: GameMetadata | null) {
    const sgdb = this.sgdb()
    const target: SgdbTarget =
      row.source === 'steam' ? { steamAppId: row.sourceId } : { title: meta?.title ?? row.title }
    const art = sgdb
      ? await sgdb.artwork(target).catch(() => ({ cover: null, hero: null, logo: null }))
      : { cover: null, hero: null, logo: null }
    const coverUrl =
      art.cover ?? (meta?.coverImageId ? igdbImageUrl(meta.coverImageId, 'cover_big') : null)
    const heroUrl = art.hero ?? (meta?.heroImageId ? igdbImageUrl(meta.heroImageId, '1080p') : null)
    return { coverUrl, heroUrl, logoUrl: art.logo }
  }

  private async download(url: string | null, prefix: string): Promise<string | null> {
    if (!url) return null
    return this.cache.download(url, prefix).catch(() => null)
  }

  /** Applies an IGDB entry (or none) and refreshes the artwork of one game. */
  async apply(gameId: number, igdbId: number | null): Promise<void> {
    const row = getGameRow(this.db, gameId)
    const meta = igdbId !== null && this.igdbConfigured() ? await this.igdb().byId(igdbId) : null
    if (igdbId !== null && this.igdbConfigured() && !meta) {
      throw new AppError('NOT_FOUND', 'Ce jeu n’existe pas sur IGDB.')
    }
    await this.store(row, meta)
  }

  async refreshArtwork(gameId: number): Promise<void> {
    const row = getGameRow(this.db, gameId)
    const meta = row.igdbId && this.igdbConfigured() ? await this.igdb().byId(row.igdbId) : null
    await this.store(row, meta)
  }

  private async store(row: GameRow, meta: GameMetadata | null): Promise<void> {
    if (!meta && !this.steamGridDbConfigured()) {
      throw new AppError(
        'VALIDATION',
        'Configurez IGDB ou SteamGridDB dans Réglages › Métadonnées.'
      )
    }
    const art = await this.artworkFor(row, meta)
    const prefix = String(row.id)
    const [cover, hero, logo, ...shots] = await Promise.all([
      this.download(art.coverUrl, `${prefix}-cover`),
      this.download(art.heroUrl, `${prefix}-hero`),
      this.download(art.logoUrl, `${prefix}-logo`),
      ...(meta?.screenshotIds ?? []).map((id) =>
        this.download(igdbImageUrl(id, 'screenshot_big'), `${prefix}-shot`)
      )
    ])
    const screenshots = shots.filter((s): s is string => !!s)

    // Replaced files are removed; what could not be downloaded keeps the previous file.
    const next = {
      coverPath: cover ?? row.coverPath,
      heroPath: hero ?? row.heroPath,
      logoPath: logo ?? row.logoPath,
      screenshots: screenshots.length ? screenshots : (row.screenshots ?? [])
    }
    this.cache.remove([
      cover && row.coverPath,
      hero && row.heroPath,
      logo && row.logoPath,
      ...(screenshots.length ? (row.screenshots ?? []) : [])
    ])

    this.db
      .update(games)
      .set({
        ...next,
        ...(meta
          ? {
              igdbId: meta.igdbId,
              description: meta.description ?? row.description,
              releaseDate: meta.releaseDate ?? row.releaseDate,
              developer: meta.developer ?? row.developer,
              genres: meta.genres.length ? meta.genres : row.genres
            }
          : {})
      })
      .where(eq(games.id, row.id))
      .run()
  }

  /** Sets a user-chosen image file as the cover. */
  setCustomCover(gameId: number, file: string): void {
    const row = getGameRow(this.db, gameId)
    const name = this.cache.importFile(file, `${row.id}-cover`)
    this.cache.remove([row.coverPath])
    this.db.update(games).set({ coverPath: name }).where(eq(games.id, row.id)).run()
  }

  /**
   * Background enrichment after an import or a sync. Without a chosen match, the first
   * IGDB result is used only when its title matches exactly; errors never propagate.
   */
  async enrich(targets: EnrichTarget[], onProgress?: () => void): Promise<number> {
    if (!this.igdbConfigured() && !this.steamGridDbConfigured()) return 0
    let done = 0
    for (const target of targets) {
      if (target.igdbId === null) continue
      try {
        const row = getGameRow(this.db, target.id)
        if (target.igdbId === undefined && row.coverPath) continue
        let igdbId = target.igdbId ?? row.igdbId
        if (igdbId == null && this.igdbConfigured()) {
          const [best] = await this.igdb().search(row.title, 3)
          if (best && normalizeTitle(best.title) === normalizeTitle(row.title)) igdbId = best.igdbId
        }
        await this.apply(row.id, igdbId ?? null)
        done++
        onProgress?.()
      } catch (error) {
        console.warn(`[metadata] enrich ${target.id} failed`, error)
      }
    }
    return done
  }

  /** Games still without a cover (e.g. just synced from an account), at most `limit`. */
  async enrichMissing(limit = 100, onProgress?: () => void): Promise<number> {
    if (!this.igdbConfigured() && !this.steamGridDbConfigured()) return 0
    const missing = this.db
      .select({ id: games.id })
      .from(games)
      .where(isNull(games.coverPath))
      .limit(limit)
      .all()
    return this.enrich(missing, onProgress)
  }

  cacheInfo() {
    return this.cache.info()
  }

  /** Empties the cache and forgets the artwork references (metadata text is kept). */
  clearCache(): void {
    this.cache.clear()
    this.db
      .update(games)
      .set({ coverPath: null, heroPath: null, logoPath: null, screenshots: null })
      .run()
  }
}
