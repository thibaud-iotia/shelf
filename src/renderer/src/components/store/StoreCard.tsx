import { formatUsd } from '@shared/format'
import type { StoreGame } from '@shared/models'
import { Badge } from '@renderer/components/ui/Badge'
import { useWishToggle } from '@renderer/lib/wish'

/** Euro price from Steam first, else the cheapest CheapShark deal (US dollars). */
export function PriceTag({ game }: { game: StoreGame }) {
  const discount = game.steamPrice?.discountPct || game.best?.discountPct || 0
  return (
    <div className="flex items-center gap-2 min-w-0">
      {discount > 0 && (
        <span className="px-1.5 py-0.5 rounded-xs bg-green-300 text-[#04150E] font-mono text-xs font-bold">
          -{discount}%
        </span>
      )}
      {game.steamPrice ? (
        <span className="flex items-baseline gap-1.5 text-sm">
          {game.steamPrice.base && <s className="text-text-lo text-xs">{game.steamPrice.base}</s>}
          <b className="text-text-hi">{game.steamPrice.final}</b>
          <span className="text-text-lo text-xs">Steam</span>
        </span>
      ) : game.best ? (
        <span className="flex items-baseline gap-1.5 text-sm">
          <b className="text-text-hi">{formatUsd(game.best.price)}</b>
          <span className="text-text-lo text-xs truncate">{game.best.storeName}</span>
        </span>
      ) : (
        <span className="text-xs text-text-lo">Prix indisponible</span>
      )}
    </div>
  )
}

export function WishButton({ game }: { game: StoreGame }) {
  const wish = useWishToggle(game)
  return (
    <button
      type="button"
      data-testid="wish-toggle"
      aria-pressed={wish.wished}
      aria-label={wish.title}
      disabled={wish.disabled}
      title={wish.title}
      onClick={(e) => {
        e.stopPropagation()
        wish.toggle()
      }}
      className={`w-8 h-8 flex-none rounded-full flex items-center justify-center text-base cursor-pointer disabled:cursor-default transition-colors ${
        wish.wished ? 'text-brand bg-brand-subtle' : 'text-text-lo bg-ink-700 hover:text-text-hi'
      }`}
    >
      {wish.wished ? '♥' : '♡'}
    </button>
  )
}

export function StoreCard({
  game,
  onOpen
}: {
  game: StoreGame
  onOpen: (game: StoreGame) => void
}) {
  return (
    <article
      data-testid="store-card"
      data-key={game.key}
      onClick={() => onOpen(game)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(game)
      }}
      tabIndex={0}
      className="group flex flex-col rounded-md overflow-hidden bg-ink-800 border border-ink-600 cursor-pointer hover:border-ink-500 focus-visible:outline-2 focus-visible:outline-brand"
    >
      <div className="relative aspect-[460/215] overflow-hidden bg-ink-700">
        {game.imageUrl && (
          <img
            src={game.imageUrl}
            alt=""
            loading="lazy"
            className={`absolute inset-0 w-full h-full object-cover ${game.ownedGameId ? 'opacity-50' : ''}`}
          />
        )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {game.ownedGameId !== null && <Badge tone="green">Possédé</Badge>}
          {game.wishlist?.fromSteam && <Badge>Liste Steam</Badge>}
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 min-w-0 text-sm font-semibold text-text-hi line-clamp-2">
            {game.title}
          </h3>
          <WishButton game={game} />
        </div>
        <PriceTag game={game} />
        {game.steamRating && (
          <span className="text-xs text-text-lo">
            Steam : {game.steamRating.text} ({game.steamRating.percent} %)
          </span>
        )}
      </div>
    </article>
  )
}
