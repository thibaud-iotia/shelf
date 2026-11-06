import type { StoreGame } from '@shared/models'
import { useAddWish, useRemoveWish } from './queries'

/** Wishlist state of a store game; a Steam wishlist entry is managed on Steam. */
export function useWishToggle(game: StoreGame) {
  const add = useAddWish()
  const remove = useRemoveWish()
  const wished = !!game.wishlist
  const locked = wished && game.wishlist!.fromSteam && !game.wishlist!.byUser
  return {
    wished,
    disabled: locked || add.isPending || remove.isPending,
    title: locked
      ? 'Dans votre liste de souhaits Steam : retirez-le depuis Steam'
      : wished
        ? 'Retirer de la liste de souhaits'
        : 'Ajouter à la liste de souhaits',
    toggle: () => {
      if (wished) remove.mutate([game.wishlist!.id])
      else
        add.mutate([
          {
            title: game.title,
            steamAppId: game.steamAppId,
            cheapsharkId: game.cheapsharkId,
            imageUrl: game.imageUrl
          }
        ])
    }
  }
}
