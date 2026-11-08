import type { KeyshopOffer, StoreGameDetail } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import { useBuy, useKeyshops } from '@renderer/lib/queries'

/** Editions listed at most (the same game sold for several launchers). */
const MAX_OFFERS = 3

/**
 * Against the official store's current price: the reseller's own "-xx %" compares with a
 * list price and would flag every game as on sale.
 */
function Versus({ versus }: { versus: NonNullable<KeyshopOffer['versus']> }) {
  if (versus.diffPct < 0) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="px-1.5 py-0.5 rounded-xs bg-green-300 text-[#04150E] font-mono text-xs font-bold whitespace-nowrap">
          {versus.diffPct}% vs {versus.storeName}
        </span>
        <span className="text-xs text-text-lo truncate">
          {versus.storeName} : {versus.price}
        </span>
      </div>
    )
  }
  return (
    <span className="text-xs text-text-lo">
      {versus.diffPct === 0
        ? `Même prix que ${versus.storeName}`
        : `${versus.storeName} est moins cher (${versus.price})`}
    </span>
  )
}

function KeyshopRow({ game, offer }: { game: StoreGameDetail; offer: KeyshopOffer }) {
  const buy = useBuy()
  return (
    <li
      data-testid="keyshop-offer"
      data-platform={offer.platform}
      className="flex flex-col gap-2 p-3 rounded-md bg-ink-900 border border-ink-600"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-hi truncate">{offer.shopName}</div>
          <div className="text-xs text-text-lo truncate" title={offer.name}>
            Clé {offer.platform}
            {offer.preorder && ' · Précommande'}
          </div>
        </div>
        <b className="text-sm text-text-hi whitespace-nowrap">{offer.price}</b>
      </div>
      {offer.versus && <Versus versus={offer.versus} />}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={offer.inStock ? 'primary' : 'secondary'}
          disabled={buy.isPending}
          onClick={() =>
            buy.mutate({
              title: game.title,
              steamAppId: game.steamAppId,
              cheapsharkId: game.cheapsharkId,
              storeId: 'ig',
              dealId: null,
              gog: null,
              instantGaming: { id: offer.productId, slug: offer.slug, platform: offer.platform }
            })
          }
        >
          {offer.inStock ? 'Acheter' : 'Voir'}
        </Button>
        <span className="text-[11px] text-text-lo">
          {offer.inStock ? 'dans le navigateur' : 'Rupture de stock'}
        </span>
      </div>
    </li>
  )
}

/**
 * Key reseller prices (Instant Gaming), apart from the official stores: loaded after the
 * sheet, and a failure only empties this block.
 */
export function KeyshopOffers({ game }: { game: StoreGameDetail }) {
  const keyshops = useKeyshops({
    title: game.title,
    steamAppId: game.steamAppId,
    cheapsharkId: game.cheapsharkId
  })
  const offers = keyshops.data?.offers.slice(0, MAX_OFFERS) ?? []
  const platforms = [...new Set(offers.map((o) => o.platform))].join(', ')
  return (
    <section data-testid="keyshops" aria-label="Revendeur de clés" className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">
        REVENDEUR DE CLÉS
      </span>
      {keyshops.isPending ? (
        <p className="text-xs text-text-lo">Recherche sur Instant Gaming…</p>
      ) : keyshops.data?.error ? (
        <p className="text-xs text-text-lo">Instant Gaming : {keyshops.data.error}</p>
      ) : offers.length === 0 ? (
        <p className="text-xs text-text-lo">Instant Gaming : pas d’offre pour ce jeu sur PC.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label="Offres Instant Gaming">
            {offers.map((offer) => (
              <KeyshopRow key={offer.productId} game={game} offer={offer} />
            ))}
          </ul>
          <p className="text-xs text-text-lo leading-relaxed">
            Clé à activer ensuite dans {platforms}. Revendeur non officiel : prix lus sur
            instant-gaming.com. Sa remise affichée part d’un prix catalogue : la comparaison utilise
            le prix actuel du magasin officiel.
          </p>
        </>
      )}
    </section>
  )
}
