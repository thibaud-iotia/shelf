import { AppError } from '../../shared/errors'
import type { PurchaseInput, StoreGameRef } from '../../shared/models'
import { INSTANT_GAMING_STORE_ID } from './instant-gaming'

const invalid = (what: string) => new AppError('VALIDATION', `${what} invalide.`)

function id(value: unknown, pattern: RegExp, what: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid(what)
  return value
}

const steamAppId = (value: unknown) => id(value, /^\d{1,10}$/, 'AppID Steam')
const cheapsharkId = (value: unknown) => id(value, /^\d{1,12}$/, 'Identifiant CheapShark')

export function validateSteamAppId(value: unknown): string {
  const appId = steamAppId(value)
  if (!appId) throw invalid('AppID Steam')
  return appId
}

export function validateStoreQuery(value: unknown): string {
  if (typeof value !== 'string') throw invalid('Recherche')
  const query = value.trim()
  if (query.length > 100) throw new AppError('VALIDATION', 'Recherche trop longue.')
  return query
}

export function validateWishId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw invalid('Identifiant de souhait')
  return value as number
}

export function validateStoreGameRef(value: unknown): StoreGameRef {
  if (!value || typeof value !== 'object') throw invalid('Jeu')
  const input = value as Record<string, unknown>
  if (typeof input.title !== 'string' || input.title.length > 300) throw invalid('Titre')
  const imageUrl = input.imageUrl
  if (imageUrl !== undefined && imageUrl !== null && typeof imageUrl !== 'string') {
    throw invalid('Image')
  }
  const ref: StoreGameRef = {
    title: input.title.trim(),
    steamAppId: steamAppId(input.steamAppId),
    cheapsharkId: cheapsharkId(input.cheapsharkId),
    imageUrl: typeof imageUrl === 'string' && imageUrl.length < 2000 ? imageUrl : null
  }
  if (!ref.title && !ref.steamAppId && !ref.cheapsharkId) throw invalid('Jeu')
  return ref
}

export function validatePurchase(value: unknown): PurchaseInput {
  const ref = validateStoreGameRef(value)
  const input = value as Record<string, unknown>
  // CheapShark store ids are numeric; "ig" is Instant Gaming.
  const storeId = id(input.storeId, /^(\d{1,4}|ig)$/, 'Magasin')
  if (!storeId) throw invalid('Magasin')
  // Deal ids are base64 strings, URL-encoded as CheapShark returns them.
  const dealId = id(input.dealId, /^[A-Za-z0-9%+/=_-]{1,200}$/, 'Offre')
  let gog: PurchaseInput['gog'] = null
  if (input.gog !== null && input.gog !== undefined) {
    const raw = input.gog as Record<string, unknown>
    const gogId = id(raw.id, /^\d{1,12}$/, 'Produit GOG')
    const slug = id(raw.slug, /^[a-z0-9_-]{1,200}$/, 'Produit GOG')
    if (!gogId || !slug) throw invalid('Produit GOG')
    gog = { id: gogId, slug }
  }
  let instantGaming: PurchaseInput['instantGaming'] = null
  if (storeId === INSTANT_GAMING_STORE_ID) {
    const raw = (input.instantGaming ?? {}) as Record<string, unknown>
    const productId = id(raw.id, /^\d{1,10}$/, 'Produit Instant Gaming')
    const slug = id(raw.slug, /^[a-z0-9-]{1,200}$/, 'Produit Instant Gaming')
    if (!productId || !slug || typeof raw.platform !== 'string' || raw.platform.length > 60) {
      throw invalid('Produit Instant Gaming')
    }
    instantGaming = { id: productId, slug, platform: raw.platform }
  }
  return { ...ref, storeId, dealId, gog, instantGaming }
}
