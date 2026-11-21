import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
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
import type { ImageKind } from '../media/shrink-policy'
import { mediaUrl } from '../media/urls'
import type { FetchLike } from '../net/http'
import type { SecretStore } from '../secrets/store'
import { limiter } from '../store/cache'
import { IgdbClient, igdbImageUrl, type GameMetadata, type IgdbExtras } from './igdb'
import { SteamGridDbClient, type ArtworkKind, type SgdbTarget } from './steamgriddb'

export const SECRET_REFS = {
  igdbClientId: 'igdb.clientId',
  igdbClientSecret: 'igdb.clientSecret',
  steamGridDbKey: 'steamgriddb.apiKey'
} as const

/** Games enriched at once: the work is mostly waiting for the network. */
export const ENRICH_CONCURRENCY = 4
/** A game without artwork is looked up again after this long (SteamGridDB grows). */
export const ARTWORK_RETRY_MS = 7 * 24 * 3600_000

/** Artwork of one game: the cover first (library), the rest later (game page only). */
type ArtworkPart = 'cover' | 'extras'
const ALL_PARTS: readonly ArtworkPart[] = ['cover', 'extras']

export interface EnrichTarget {
  id: number
  /** number = chosen match, null = "aucun", undefined = pick automatically. */
  igdbId?: number | null
}

/** IGDB metadata + SteamGridDB artwork, cached locally. */
export class MetadataService {
  private igdbClient: IgdbClient | null = null
  /** SteamGridDB ids found by title search, reused by the second pass of `enrich`. */
  private readonly sgdbIds = new Map<string, number>()

  constructor(
    private readonly db: ShelfDatabase,
    private readonly secrets: SecretStore,
    private readonly cache: MediaCache,
    private readonly fetch?: FetchLike,
    private readonly now: () => number = Date.now
  ) {}

  /** New keys or an emptied cache: games without artwork deserve a new lookup. */
  private forgetArtworkChecks(): void {
    this.db.update(games).set({ artworkCheckedAt: null }).run()
  }

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
    this.sgdbIds.clear()
    this.forgetArtworkChecks()
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
    return key ? new SteamGridDbClient(key, this.fetch, this.sgdbIds) : null
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

  /**
   * Image URLs of the requested parts: SteamGridDB first, IGDB as fallback. `failed`: the
   * SteamGridDB lookup failed (network…), so a missing image does not mean "none exists".
   */
  private async artworkFor(row: GameRow, meta: GameMetadata | null, parts: readonly ArtworkPart[]) {
    const sgdb = this.sgdb()
    const target: SgdbTarget =
      row.source === 'steam' ? { steamAppId: row.sourceId } : { title: meta?.title ?? row.title }
    const kinds: ArtworkKind[] = [
      ...(parts.includes('cover') ? (['grids'] as const) : []),
      ...(parts.includes('extras') ? (['heroes', 'logos'] as const) : [])
    ]
    let failed = false
    const art = sgdb
      ? await sgdb.artwork(target, kinds).catch(() => {
          failed = true
          return { cover: null, hero: null, logo: null }
        })
      : { cover: null, hero: null, logo: null }
    const igdbCover = meta?.coverImageId ? igdbImageUrl(meta.coverImageId, 'cover_big') : null
    const igdbHero = meta?.heroImageId ? igdbImageUrl(meta.heroImageId, '1080p') : null
    return {
      coverUrl: parts.includes('cover') ? (art.cover ?? igdbCover) : null,
      heroUrl: parts.includes('extras') ? (art.hero ?? igdbHero) : null,
      logoUrl: art.logo,
      shotUrls: parts.includes('extras')
        ? (meta?.screenshotIds ?? []).map((id) => igdbImageUrl(id, 'screenshot_big'))
        : [],
      failed
    }
  }

  private async download(url: string | null, prefix: string, kind: ImageKind) {
    if (!url) return null
    return this.cache.download(url, prefix, kind).catch(() => null)
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

  private async store(
    row: GameRow,
    meta: GameMetadata | null,
    parts: readonly ArtworkPart[] = ALL_PARTS
  ): Promise<{ cover: boolean }> {
    if (!meta && !this.steamGridDbConfigured()) {
      throw new AppError(
        'VALIDATION',
        'Configurez IGDB ou SteamGridDB dans Réglages › Métadonnées.'
      )
    }
    const art = await this.artworkFor(row, meta, parts)
    const prefix = String(row.id)
    const [cover, hero, logo, ...shots] = await Promise.all([
      this.download(art.coverUrl, `${prefix}-cover`, 'cover'),
      this.download(art.heroUrl, `${prefix}-hero`, 'hero'),
      this.download(art.logoUrl, `${prefix}-logo`, 'logo'),
      ...art.shotUrls.map((url) => this.download(url, `${prefix}-shot`, 'shot'))
    ])
    const screenshots = shots.filter((s): s is string => !!s)
    // The lookup ended: an image was found, or there is none (not a network failure).
    const checked = parts.includes('cover') && (!!cover || (!art.coverUrl && !art.failed))

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
        ...(checked ? { artworkCheckedAt: new Date(this.now()) } : {}),
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
    return { cover: !!cover }
  }

  /** IGDB videos and websites for the game page; null when IGDB is not configured. */
  async extras(igdbId: number): Promise<IgdbExtras | null> {
    return this.igdbConfigured() ? this.igdb().extras(igdbId) : null
  }

  /** Sets a user-chosen image file as the cover. */
  setCustomCover(gameId: number, file: string): void {
    const row = getGameRow(this.db, gameId)
    const name = this.cache.importFile(file, `${row.id}-cover`)
    this.cache.remove([row.coverPath])
    this.db.update(games).set({ coverPath: name }).where(eq(games.id, row.id)).run()
  }

  /**
   * IGDB entry for automatic enrichment: the chosen one, the known one, or the first search
   * result when its title matches exactly (the search returns full entries: no second query).
   */
  private async metadataFor(row: GameRow, chosen: number | undefined) {
    if (!this.igdbConfigured()) return null
    const igdbId = chosen ?? row.igdbId
    if (igdbId != null) return this.igdb().byId(igdbId)
    const [best] = await this.igdb().search(row.title, 3)
    return best && normalizeTitle(best.title) === normalizeTitle(row.title) ? best : null
  }

  private markChecked(gameId: number): void {
    this.db
      .update(games)
      .set({ artworkCheckedAt: new Date(this.now()) })
      .where(eq(games.id, gameId))
      .run()
  }

  /**
   * Background enrichment after an import or a sync, `ENRICH_CONCURRENCY` games at a time.
   * Two passes: metadata and covers of every game first (the library fills up quickly), then
   * heroes, logos and screenshots, only shown on the game page. Errors never propagate.
   */
  async enrich(targets: EnrichTarget[], onProgress?: () => void): Promise<number> {
    if (!this.igdbConfigured() && !this.steamGridDbConfigured()) return 0
    const run = limiter(ENRICH_CONCURRENCY)
    let done = 0
    // Games with a cover get the rest of their artwork in the second pass.
    const found: { id: number; meta: GameMetadata | null }[] = []
    await Promise.all(
      targets.map((target) =>
        run(async () => {
          if (target.igdbId === null) return
          try {
            const row = getGameRow(this.db, target.id)
            if (target.igdbId === undefined && row.coverPath) return
            const meta = await this.metadataFor(row, target.igdbId)
            // IGDB only, no match: nothing to fetch until the keys change.
            if (!meta && !this.steamGridDbConfigured()) return this.markChecked(row.id)
            const { cover } = await this.store(row, meta, ['cover'])
            done++
            if (cover) found.push({ id: row.id, meta })
            onProgress?.()
          } catch (error) {
            console.warn(`[metadata] enrich ${target.id} failed`, error)
          }
        })
      )
    )
    await Promise.all(
      found.map(({ id, meta }) =>
        run(async () => {
          try {
            await this.store(getGameRow(this.db, id), meta, ['extras'])
            onProgress?.()
          } catch (error) {
            console.warn(`[metadata] artwork ${id} failed`, error)
          }
        })
      )
    )
    return done
  }

  /**
   * Games still without a cover (e.g. just synced from an account). Those whose last lookup
   * found nothing wait `ARTWORK_RETRY_MS` before the next one.
   */
  async enrichMissing(onProgress?: () => void): Promise<number> {
    if (!this.igdbConfigured() && !this.steamGridDbConfigured()) return 0
    const retryBefore = new Date(this.now() - ARTWORK_RETRY_MS)
    const missing = this.db
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          isNull(games.coverPath),
          or(isNull(games.artworkCheckedAt), lt(games.artworkCheckedAt, retryBefore))
        )
      )
      .all()
    return this.enrich(missing, onProgress)
  }

  /**
   * Shrinks artwork downloaded before it was stored at display size, one file at a time.
   * Returns the number of files replaced.
   */
  async compactCache(onProgress?: () => void): Promise<number> {
    const rows = this.db
      .select({
        id: games.id,
        coverPath: games.coverPath,
        heroPath: games.heroPath,
        logoPath: games.logoPath,
        screenshots: games.screenshots
      })
      .from(games)
      .where(
        or(
          isNotNull(games.coverPath),
          isNotNull(games.heroPath),
          isNotNull(games.logoPath),
          isNotNull(games.screenshots)
        )
      )
      .all()
    const fields = [
      ['coverPath', 'cover'],
      ['heroPath', 'hero'],
      ['logoPath', 'logo']
    ] as const
    let replaced = 0
    for (const row of rows) {
      const changes: { coverPath?: string; heroPath?: string; logoPath?: string } = {}
      let count = 0
      for (const [field, kind] of fields) {
        const name = row[field]
        const next = name ? await this.cache.compact(name, kind, `${row.id}-${kind}`) : null
        if (next) {
          changes[field] = next
          count++
        }
      }
      const shots: string[] = []
      let shotsChanged = false
      for (const name of row.screenshots ?? []) {
        const next = await this.cache.compact(name, 'shot', `${row.id}-shot`)
        if (next) {
          shotsChanged = true
          count++
        }
        shots.push(next ?? name)
      }
      if (!count) continue
      this.db
        .update(games)
        .set({ ...changes, ...(shotsChanged ? { screenshots: shots } : {}) })
        .where(eq(games.id, row.id))
        .run()
      replaced += count
      onProgress?.()
    }
    return replaced
  }

  cacheInfo() {
    return this.cache.info()
  }

  /** Empties the cache and forgets the artwork references (metadata text is kept). */
  clearCache(): void {
    this.cache.clear()
    this.db
      .update(games)
      .set({
        coverPath: null,
        heroPath: null,
        logoPath: null,
        screenshots: null,
        artworkCheckedAt: null
      })
      .run()
  }
}
