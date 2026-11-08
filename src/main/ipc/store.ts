import type { AppContext } from '../context'
import {
  validatePurchase,
  validateSteamAppId,
  validateStoreGameRef,
  validateStoreQuery,
  validateWishId
} from '../store/validation'
import { handle } from './handle'

export function registerStoreHandlers(ctx: AppContext): void {
  handle('store:wishlist', () => ctx.store.wishlist())
  handle('store:syncWishlist', () => ctx.store.wishlist({ forceSync: true }))
  handle('store:deals', () => ctx.store.deals())
  handle('store:search', (query) => ctx.store.search(validateStoreQuery(query)))
  handle('store:game', (ref) => ctx.store.game(validateStoreGameRef(ref)))
  handle('store:keyshops', (ref) => ctx.store.keyshops(validateStoreGameRef(ref)))
  handle('store:overview', (appId) => ctx.insights.overviewForApp(validateSteamAppId(appId)))
  handle('store:news', (appId) => ctx.insights.newsForApp(validateSteamAppId(appId)))
  handle('store:addWish', (ref) => {
    ctx.store.addWish(validateStoreGameRef(ref))
    return null
  })
  handle('store:removeWish', (id) => {
    ctx.store.removeWish(validateWishId(id))
    return null
  })
  handle('store:buy', (input) => ctx.store.buy(validatePurchase(input)))
}
