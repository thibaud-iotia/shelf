import type { PurchaseOpener } from '../../shared/models'
import { dealRedirectUrl, STORE_IDS } from './cheapshark'
import { gogGalaxyUri, gogStoreUrl } from './gog'
import { INSTANT_GAMING_STORE_ID, instantGamingProductUrl } from './instant-gaming'
import { steamStoreUri, steamStoreUrl } from './steam'

export interface PurchaseOffer {
  storeId: string
  dealId: string | null
  steamAppId: string | null
  gog: { id: string; slug: string } | null
  instantGaming?: { id: string; slug: string } | null
}

export interface PurchaseEnv {
  platform: NodeJS.Platform
  /** The launcher is installed (its URI scheme is registered). */
  steam: boolean
  gogGalaxy: boolean
}

export interface PurchaseTarget {
  url: string
  opensIn: PurchaseOpener
}

/**
 * Where "Acheter" goes. Payment always happens in the launcher's own window (or the store's
 * site): Steam store page in the Steam client, GOG product in Galaxy, else the store's page in
 * the browser (CheapShark's purchase link for stores without a usable launcher URI, like Epic;
 * the product page for Instant Gaming, whose key is then activated in its launcher).
 */
export function purchaseTarget(offer: PurchaseOffer, env: PurchaseEnv): PurchaseTarget | null {
  if (offer.storeId === STORE_IDS.steam && offer.steamAppId) {
    return env.steam
      ? { url: steamStoreUri(offer.steamAppId), opensIn: 'steam' }
      : { url: steamStoreUrl(offer.steamAppId), opensIn: 'browser' }
  }
  if (offer.storeId === STORE_IDS.gog && offer.gog) {
    // Galaxy only exists on Windows and macOS (Linux: Heroic, which has no store URI).
    if (env.gogGalaxy && env.platform !== 'linux') {
      return { url: gogGalaxyUri(offer.gog.id), opensIn: 'gog' }
    }
    return { url: gogStoreUrl(offer.gog.slug), opensIn: 'browser' }
  }
  if (offer.storeId === INSTANT_GAMING_STORE_ID) {
    return offer.instantGaming
      ? {
          url: instantGamingProductUrl(offer.instantGaming.id, offer.instantGaming.slug),
          opensIn: 'browser'
        }
      : null
  }
  if (offer.dealId) return { url: dealRedirectUrl(offer.dealId), opensIn: 'browser' }
  return null
}
