import { useEffect, useState, type ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { formatDay, pluralize } from '@shared/format'
import type { StoreGame } from '@shared/models'
import { PriceTag, StoreCard } from '@renderer/components/store/StoreCard'
import { useWishToggle } from '@renderer/lib/wish'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { Input } from '@renderer/components/ui/Input'
import { useDeals, useStoreSearch, useSyncWishlist, useWishlist } from '@renderer/lib/queries'
import { useUiStore, type StoreTab } from '@renderer/stores/ui'

function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Opens the store page of a game. */
function useOpenStoreGame() {
  const navigate = useUiStore((s) => s.navigate)
  return (game: StoreGame) =>
    navigate({
      name: 'storeGame',
      ref: {
        title: game.title,
        steamAppId: game.steamAppId,
        cheapsharkId: game.cheapsharkId,
        imageUrl: game.imageUrl
      }
    })
}

function Grid({ games, onOpen }: { games: StoreGame[]; onOpen: (game: StoreGame) => void }) {
  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
      {games.map((game) => (
        <StoreCard key={game.key} game={game} onOpen={onOpen} />
      ))}
    </div>
  )
}

function QueryGrid({
  query,
  empty,
  onOpen
}: {
  query: UseQueryResult<StoreGame[]>
  empty: string
  onOpen: (game: StoreGame) => void
}) {
  if (query.isPending) return <p className="text-sm text-text-lo">Chargement…</p>
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-text-mid">
        {query.error.message}
      </p>
    )
  }
  if (query.data.length === 0) {
    return (
      <p data-testid="store-empty" className="text-sm text-text-lo">
        {empty}
      </p>
    )
  }
  return <Grid games={query.data} onOpen={onOpen} />
}

function Section({
  title,
  more,
  children,
  testId
}: {
  title: string
  more?: { label: string; onClick: () => void }
  children: ReactNode
  testId?: string
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-3">
      <div className="flex items-center">
        <h2 className="font-display font-bold text-lg text-text-hi">{title}</h2>
        {more && (
          <button
            type="button"
            onClick={more.onClick}
            className="ml-auto text-xs font-semibold text-text-lo hover:text-text-hi cursor-pointer"
          >
            {more.label} →
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

const FEATURED = 5
const ROTATE_MS = 8000

/** Big banner of the best deals, rotating; a click opens the game's store page. */
function Featured({ games, onOpen }: { games: StoreGame[]; onOpen: (game: StoreGame) => void }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || games.length < 2) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % games.length), ROTATE_MS)
    return () => clearInterval(timer)
  }, [paused, games.length])
  const game = games[index % games.length]!
  const wish = useWishToggle(game)

  return (
    <div
      data-testid="store-featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative h-[300px] flex-none rounded-lg overflow-hidden border border-ink-600 bg-ink-800"
    >
      {game.imageUrl && (
        <img
          src={game.imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,12,.95)_30%,rgba(8,8,12,.4))]" />
      <div className="relative h-full flex items-center gap-8 px-9">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <span className="text-[11px] font-semibold tracking-[.14em] text-brand">À LA UNE</span>
          <h2 className="font-display font-bold text-[34px] leading-[1.05] tracking-[-.02em] text-white line-clamp-2">
            {game.title}
          </h2>
          <PriceTag game={game} />
          {game.steamRating && (
            <span className="text-sm text-text-mid">
              Évaluations Steam : {game.steamRating.text} ({game.steamRating.percent} %)
            </span>
          )}
          <div className="flex items-center gap-2.5 mt-1">
            <Button onClick={() => onOpen(game)}>Voir le jeu</Button>
            <Button
              variant="secondary"
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
        </div>
        {game.imageUrl && (
          <button
            type="button"
            onClick={() => onOpen(game)}
            aria-label={`Ouvrir ${game.title}`}
            className="flex-none w-[46%] max-w-[520px] aspect-[460/215] rounded-md overflow-hidden shadow-[0_18px_60px_rgba(0,0,0,.55)] cursor-pointer"
          >
            <img src={game.imageUrl} alt="" className="w-full h-full object-cover" />
          </button>
        )}
      </div>
      {games.length > 1 && (
        <div className="absolute left-9 bottom-4 flex gap-1.5">
          {games.map((g, i) => (
            <button
              key={g.key}
              type="button"
              aria-label={`À la une : ${g.title}`}
              aria-current={i === index % games.length}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full cursor-pointer transition-all ${
                i === index % games.length ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Horizontal row of cards (wishlist preview). */
function Row({ games, onOpen }: { games: StoreGame[]; onOpen: (game: StoreGame) => void }) {
  return (
    <div className="grid grid-flow-col auto-cols-[250px] gap-4 overflow-x-auto pb-2">
      {games.map((game) => (
        <StoreCard key={game.key} game={game} onOpen={onOpen} />
      ))}
    </div>
  )
}

const HOME_DEALS = 8

function HomeTab({ onOpen }: { onOpen: (game: StoreGame) => void }) {
  const deals = useDeals(true)
  const wishlist = useWishlist()
  const setTab = useUiStore((s) => s.setStoreTab)
  const navigate = useUiStore((s) => s.navigate)

  const all = deals.data ?? []
  const notOwned = all.filter((g) => g.ownedGameId === null)
  const featured = notOwned.filter((g) => g.steamAppId).slice(0, FEATURED)
  const featuredKeys = new Set(featured.map((g) => g.key))
  const free = notOwned.filter((g) => g.best?.price === 0)
  const topRated = notOwned
    .filter((g) => (g.steamRating?.percent ?? 0) >= 85 && !featuredKeys.has(g.key))
    .sort((a, b) => b.steamRating!.percent - a.steamRating!.percent)
    .slice(0, 4)
  const wishes = wishlist.data?.items ?? []
  const onSale = wishes.filter((g) => ((g.steamPrice?.discountPct || g.best?.discountPct) ?? 0) > 0)

  return (
    <div className="flex flex-col gap-8">
      {deals.isPending ? (
        <div className="h-[300px] rounded-lg bg-ink-800 border border-ink-600 animate-pulse" />
      ) : deals.isError ? (
        <p role="alert" className="text-sm text-text-mid">
          {deals.error.message}
        </p>
      ) : (
        featured.length > 0 && <Featured games={featured} onOpen={onOpen} />
      )}

      <Section
        title="Votre liste de souhaits"
        testId="home-wishlist"
        more={wishes.length ? { label: 'Tout voir', onClick: () => setTab('wishlist') } : undefined}
      >
        {wishes.length > 0 ? (
          <>
            {onSale.length > 0 && (
              <span className="text-sm text-green-300">
                {pluralize(onSale.length, 'jeu', 'jeux')} de votre liste en promotion
              </span>
            )}
            <Row games={wishes.slice(0, 10)} onOpen={onOpen} />
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-md border border-dashed border-ink-500 text-sm text-text-mid">
            <span>
              Ajoutez des jeux avec ♡ : Shelf suit leurs prix et vous dit quand ils sont en
              promotion.
            </span>
            {wishlist.data && !wishlist.data.steam.connected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ name: 'settings', section: 'accounts' })}
              >
                Importer ma liste Steam
              </Button>
            )}
          </div>
        )}
      </Section>

      {free.length > 0 && (
        <Section title="Gratuits en ce moment" testId="home-free">
          <Grid games={free.slice(0, 4)} onOpen={onOpen} />
        </Section>
      )}

      {notOwned.length > 0 && (
        <Section
          title="Promotions du moment"
          testId="home-deals"
          more={{ label: 'Toutes les promotions', onClick: () => setTab('deals') }}
        >
          <Grid
            games={notOwned.filter((g) => !featuredKeys.has(g.key)).slice(0, HOME_DEALS)}
            onOpen={onOpen}
          />
        </Section>
      )}

      {topRated.length > 0 && (
        <Section title="Très bien notés sur Steam, en promotion" testId="home-top">
          <Grid games={topRated} onOpen={onOpen} />
        </Section>
      )}
    </div>
  )
}

function WishlistTab({ onOpen }: { onOpen: (game: StoreGame) => void }) {
  const wishlist = useWishlist()
  const sync = useSyncWishlist()
  const navigate = useUiStore((s) => s.navigate)

  if (wishlist.isPending) return <p className="text-sm text-text-lo">Chargement…</p>
  if (wishlist.isError) {
    return (
      <p role="alert" className="text-sm text-text-mid">
        {wishlist.error.message}
      </p>
    )
  }
  const { items, steam, pricesError } = wishlist.data
  return (
    <div className="flex flex-col gap-4">
      <div
        data-testid="wishlist-status"
        className="flex flex-wrap items-center gap-3 text-sm text-text-mid"
      >
        {steam.connected ? (
          <>
            <span>
              Liste de souhaits Steam importée
              {steam.syncedAt ? ` · ${formatDay(steam.syncedAt)}` : ''}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? 'Actualisation…' : '⟳ Actualiser'}
            </Button>
          </>
        ) : (
          <>
            <span>Connectez un compte Steam pour importer votre liste de souhaits Steam.</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ name: 'settings', section: 'accounts' })}
            >
              Comptes
            </Button>
          </>
        )}
      </div>
      {steam.error && (
        <p role="alert" className="text-sm text-amber-300">
          {steam.error}
        </p>
      )}
      {pricesError && (
        <p role="alert" className="text-sm text-amber-300">
          Prix indisponibles : {pricesError}
        </p>
      )}
      {items.length === 0 ? (
        <p data-testid="store-empty" className="text-sm text-text-lo">
          Votre liste de souhaits est vide : ajoutez des jeux avec ♡ depuis l’accueil, les
          promotions ou la recherche.
        </p>
      ) : (
        <Grid games={items} onOpen={onOpen} />
      )}
    </div>
  )
}

const TABS: { id: StoreTab; label: string }[] = [
  { id: 'home', label: 'Accueil' },
  { id: 'wishlist', label: 'Liste de souhaits' },
  { id: 'deals', label: 'Promotions' }
]

/** Store: home (featured deals, wishlist, free games), wishlist, deals and search. */
export function StoreView() {
  const tab = useUiStore((s) => s.storeTab)
  const setTab = useUiStore((s) => s.setStoreTab)
  const text = useUiStore((s) => s.storeQuery)
  const setText = useUiStore((s) => s.setStoreQuery)
  const open = useOpenStoreGame()
  const query = useDebounced(text)
  const searching = query.trim().length > 0
  const search = useStoreSearch(query)
  const deals = useDeals(tab === 'deals' && !searching)
  const wishlist = useWishlist()

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-[18px] px-7 py-6">
      <header className="flex items-center gap-4">
        <h1 className="font-display font-bold text-[28px] tracking-[-.02em] text-text-hi">
          Boutique
        </h1>
        <div className="flex gap-2" role="tablist">
          {TABS.map((t) => (
            <Chip
              key={t.id}
              role="tab"
              active={!searching && tab === t.id}
              onClick={() => {
                setText('')
                setTab(t.id)
              }}
            >
              {t.label}
              {t.id === 'wishlist' && wishlist.data && (
                <span className="font-mono text-xs opacity-70">{wishlist.data.items.length}</span>
              )}
            </Chip>
          ))}
        </div>
        <div className="ml-auto w-[320px]">
          <Input
            aria-label="Rechercher un jeu à acheter"
            placeholder="Rechercher un jeu à acheter…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setText('')
            }}
          />
        </div>
      </header>

      {searching ? (
        <>
          <h2 className="text-sm font-semibold text-text-mid">Résultats pour « {query.trim()} »</h2>
          <QueryGrid
            query={search}
            empty="Aucun jeu trouvé chez les magasins suivis."
            onOpen={open}
          />
        </>
      ) : tab === 'home' ? (
        <HomeTab onOpen={open} />
      ) : tab === 'wishlist' ? (
        <WishlistTab onOpen={open} />
      ) : (
        <>
          {deals.data && (
            <span className="text-xs text-text-lo">
              {pluralize(deals.data.length, 'promotion')} sur Steam, GOG et Epic Games Store, les
              mieux notées d’abord
            </span>
          )}
          <QueryGrid query={deals} empty="Aucune promotion en ce moment." onOpen={open} />
        </>
      )}
    </section>
  )
}
