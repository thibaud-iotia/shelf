import { useState, type ReactNode } from 'react'
import { formatFullDate, formatUsd } from '@shared/format'
import type { PurchaseOpener, StoreGameDetail, StoreGameRef, StoreOffer } from '@shared/models'
import { heroGradient } from '@renderer/lib/artwork'
import { BackBar, TabBar } from '@renderer/components/game/DetailChrome'
import { availableTabs, type DetailTab } from '@renderer/lib/detail'
import { InsightsSide } from '@renderer/components/game/insights/InsightsSide'
import { MediaGallery } from '@renderer/components/game/insights/MediaGallery'
import { NewsPanel } from '@renderer/components/game/insights/NewsPanel'
import {
  AboutSection,
  Languages,
  LatestNews,
  Requirements,
  StoreFacts
} from '@renderer/components/game/insights/StoreSections'
import { VideosPanel } from '@renderer/components/game/insights/VideosPanel'
import { useWishToggle } from '@renderer/lib/wish'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { useBuy, useStoreGame, useStoreNews, useStoreOverview } from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

const OPENS_IN: Record<PurchaseOpener, string> = {
  steam: 'dans Steam',
  gog: 'dans GOG Galaxy',
  browser: 'dans le navigateur'
}

/** "24,50 €" when the store gives a price in euros, else CheapShark's dollars. */
function offerPrice(offer: StoreOffer): string | null {
  if (offer.localPrice) return offer.localPrice.final
  return offer.price !== null ? formatUsd(offer.price) : null
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">{children}</span>
}

function useBuyOffer(game: StoreGameDetail) {
  const buy = useBuy()
  return {
    pending: buy.isPending,
    buy: (offer: StoreOffer) =>
      buy.mutate({
        title: game.title,
        steamAppId: game.steamAppId,
        cheapsharkId: game.cheapsharkId,
        storeId: offer.storeId,
        dealId: offer.dealId,
        gog: offer.gog
      })
  }
}

function OfferRow({ game, offer }: { game: StoreGameDetail; offer: StoreOffer }) {
  const { buy, pending } = useBuyOffer(game)
  const usd =
    offer.price !== null && offer.localPrice
      ? formatUsd(offer.price)
      : offer.retailPrice !== null && offer.price !== null && offer.retailPrice > offer.price
        ? `au lieu de ${formatUsd(offer.retailPrice)}`
        : null
  return (
    <li
      data-testid="store-offer"
      data-store={offer.storeName}
      className="flex flex-col gap-2 p-3 rounded-md bg-ink-900 border border-ink-600"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-hi truncate">{offer.storeName}</div>
          <div className="flex items-baseline gap-1.5 text-sm">
            {offer.localPrice?.base && (
              <s className="text-xs text-text-lo">{offer.localPrice.base}</s>
            )}
            <b className="text-text-hi">{offerPrice(offer) ?? '—'}</b>
            {usd && <span className="text-xs text-text-lo">{usd}</span>}
          </div>
        </div>
        {offer.discountPct > 0 && (
          <span className="px-1.5 py-0.5 rounded-xs bg-green-300 text-[#04150E] font-mono text-xs font-bold">
            -{offer.discountPct}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => buy(offer)}>
          Acheter
        </Button>
        <span className="text-[11px] text-text-lo">{OPENS_IN[offer.opensIn]}</span>
      </div>
    </li>
  )
}

function OffersCard({ game, children }: { game: StoreGameDetail; children?: ReactNode }) {
  return (
    <aside className="w-[300px] flex-none self-start flex flex-col gap-3 p-[22px] rounded-lg bg-ink-800 border border-ink-600">
      <Label>OÙ L’ACHETER</Label>
      {game.offers.length === 0 ? (
        <p className="text-sm text-text-lo">Aucune offre trouvée pour ce jeu.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Offres">
          {game.offers.map((offer) => (
            <OfferRow key={`${offer.storeId}:${offer.dealId}`} game={game} offer={offer} />
          ))}
        </ul>
      )}
      {game.lowestEver && (
        <span data-testid="lowest-ever" className="text-xs text-text-lo">
          Plus bas historique : {formatUsd(game.lowestEver.price)} (
          {formatFullDate(game.lowestEver.date)})
        </span>
      )}
      <p className="text-xs text-text-lo leading-relaxed">
        Le paiement se fait dans le launcher ou sur le site du magasin ; à votre retour dans Shelf,
        l’achat est détecté et le jeu rejoint la bibliothèque. Prix en dollars : CheapShark.
      </p>
      {children}
    </aside>
  )
}

function HeroActions({ game }: { game: StoreGameDetail }) {
  const navigate = useUiStore((s) => s.navigate)
  const { buy, pending } = useBuyOffer(game)
  const wish = useWishToggle(game)
  const best = game.offers[0]
  return (
    <div className="absolute right-10 bottom-[34px] flex items-center gap-2.5">
      {game.ownedGameId !== null ? (
        <Button size="lg" onClick={() => navigate({ name: 'game', id: game.ownedGameId! })}>
          Dans votre bibliothèque →
        </Button>
      ) : best ? (
        <Button size="lg" disabled={pending} onClick={() => buy(best)}>
          Acheter
          {offerPrice(best) && <span className="font-normal opacity-90">· {offerPrice(best)}</span>}
        </Button>
      ) : (
        <Button size="lg" disabled>
          Indisponible
        </Button>
      )}
      <Button
        variant="secondary"
        size="lg"
        data-testid="wish-toggle"
        aria-label={wish.title}
        title={wish.title}
        aria-pressed={wish.wished}
        disabled={wish.disabled}
        className={wish.wished ? 'text-red-300!' : ''}
        onClick={wish.toggle}
      >
        {wish.wished ? '♥' : '♡'}
      </Button>
    </div>
  )
}

/**
 * Store page of a game to buy: laid out like the page of a library game (hero, gallery,
 * description, Steam facts, news, videos), with "Acheter" instead of "Jouer" and every
 * store's offer in the side card.
 */
export function StoreGameView({ gameRef }: { gameRef: StoreGameRef }) {
  const detail = useStoreGame(gameRef)
  const appId = detail.data?.steamAppId ?? gameRef.steamAppId
  const insights = useStoreOverview(appId)
  const news = useStoreNews(appId)
  const [selectedTab, setTab] = useState<DetailTab>('overview')

  const game = detail.data
  const title = game?.title || gameRef.title
  const store = insights.data?.store ?? null
  const heroUrl =
    game?.heroUrl ?? store?.screenshots[0]?.fullUrl ?? game?.imageUrl ?? gameRef.imageUrl ?? null
  const tabs = availableTabs(insights.data, false)
  const tab = tabs.some((t) => t.id === selectedTab) ? selectedTab : 'overview'
  const year = store?.releaseDate?.match(/\d{4}/)?.[0] ?? null
  const meta = [year, store?.developers[0]].filter(Boolean).join(' · ')

  return (
    <section className="flex-1 min-w-0 flex flex-col -mt-[var(--title-bar)]">
      <BackBar title={title} />
      <div
        className="relative h-[340px] flex-none"
        style={{ background: heroUrl ? undefined : heroGradient(title) }}
      >
        {heroUrl && (
          <img src={heroUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(transparent_40%,var(--surface-page))]" />
        <h1 className="absolute left-10 bottom-[30px] max-w-[50%] font-display font-bold text-[56px] leading-none tracking-[-.03em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,.6)]">
          {title}
        </h1>
        {game && <HeroActions game={game} />}
      </div>

      <div className="flex gap-10 px-10 pt-2 pb-8">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {game?.ownedGameId != null && (
            <p className="text-sm text-green-300">Ce jeu est déjà dans votre bibliothèque.</p>
          )}
          {tabs.length > 1 && <TabBar tabs={tabs} active={tab} onChange={setTab} />}
          {tab === 'news' && <NewsPanel news={news} />}
          {tab === 'videos' && insights.data && <VideosPanel videos={insights.data.videos} />}
          {tab === 'overview' && (
            <>
              {!appId && detail.isSuccess && (
                <p className="text-sm text-text-lo">
                  Ce jeu n’est pas vendu sur Steam : pas de fiche détaillée, seulement les offres
                  des magasins.
                </p>
              )}
              {insights.isPending && appId && (
                <p data-testid="panel-loading" className="text-sm text-text-lo">
                  Chargement de la fiche…
                </p>
              )}
              {store && <MediaGallery video={insights.data?.videos[0]} shots={store.screenshots} />}
              {store && (store.genres.length > 0 || meta) && (
                <div className="flex flex-wrap items-center gap-2">
                  {store.genres.map((genre) => (
                    <Chip key={genre} variant="outline" tabIndex={-1}>
                      {genre}
                    </Chip>
                  ))}
                  {meta && <span className="text-text-lo">· {meta}</span>}
                </div>
              )}
              {store?.shortDescription && (
                <p
                  data-testid="description"
                  className="max-w-[760px] text-base leading-[1.65] text-text-mid select-text whitespace-pre-line"
                >
                  {store.shortDescription}
                </p>
              )}
              {store && <StoreFacts store={store} />}
              {appId && <LatestNews news={news} onMore={() => setTab('news')} />}
              {store && <AboutSection blocks={store.about} />}
              {store && <Requirements store={store} />}
              {store && <Languages store={store} />}
            </>
          )}
        </div>
        {detail.isError ? (
          <aside role="alert" className="w-[300px] flex-none text-sm text-text-mid">
            {detail.error.message}
          </aside>
        ) : game ? (
          <OffersCard game={game}>
            {insights.data && <InsightsSide insights={insights.data} />}
          </OffersCard>
        ) : (
          <aside className="w-[300px] flex-none text-sm text-text-lo">Recherche des offres…</aside>
        )}
      </div>
    </section>
  )
}
