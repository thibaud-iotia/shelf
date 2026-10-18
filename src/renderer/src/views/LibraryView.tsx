import { useMemo } from 'react'
import { SOURCE_LABELS } from '@shared/domain'
import { pluralize } from '@shared/format'
import { filterGames } from '@shared/library'
import type { Game } from '@shared/models'
import { GameGrid } from '@renderer/components/game/GameGrid'
import { GameList } from '@renderer/components/game/GameList'
import { FilterBar } from '@renderer/components/library/FilterBar'
import { Button } from '@renderer/components/ui/Button'
import { useGameContextMenu, usePlay, useStartScan } from '@renderer/lib/actions'
import { useGames, useSettings } from '@renderer/lib/queries'
import { useUiStore, type ListRoute } from '@renderer/stores/ui'

function routeTitle(route: ListRoute): string {
  switch (route.name) {
    case 'favorites':
      return 'Favoris'
    case 'recent':
      return 'Récents'
    case 'source':
      return SOURCE_LABELS[route.source]
    default:
      return 'Bibliothèque'
  }
}

function gamesFor(route: ListRoute, games: Game[]): Game[] {
  switch (route.name) {
    case 'favorites':
      return games.filter((g) => g.favorite)
    case 'recent':
      return games
        .filter((g) => g.lastPlayedAt !== null)
        .sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)
    case 'source':
      return games.filter((g) => g.source === route.source)
    default:
      return games
  }
}

// Mockup 01 — library header, filter bar and cover grid (or list).
export function LibraryView({ route }: { route: ListRoute }) {
  const games = useGames()
  const settings = useSettings()
  const navigate = useUiStore((s) => s.navigate)
  const openGameForm = useUiStore((s) => s.openGameForm)
  const text = useUiStore((s) => s.filterText)
  const install = useUiStore((s) => s.installFilter)
  const favoritesOnly = useUiStore((s) => s.favoritesOnly)
  const tag = useUiStore((s) => s.tagFilter)
  const layout = useUiStore((s) => s.layout)
  const play = usePlay()
  const scan = useStartScan()
  const contextMenu = useGameContextMenu()

  const showHidden = settings.data?.showHidden ?? false
  const shown = useMemo(
    () =>
      filterGames(gamesFor(route, games.data ?? []), {
        text,
        install,
        favoritesOnly,
        tag,
        showHidden
      }),
    [route, games.data, text, install, favoritesOnly, tag, showHidden]
  )
  const total = games.data?.length ?? 0
  const open = (game: Game) => navigate({ name: 'game', id: game.id })

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-[18px] px-7 py-6">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display font-bold text-[28px] tracking-[-.02em] text-text-hi">
          {routeTitle(route)}
        </h1>
        <span data-testid="game-count" className="text-text-lo">
          {pluralize(shown.length, 'jeu', 'jeux')}
        </span>
        <span className="ml-auto self-center flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={scan.isPending}
            onClick={() => void scan.run()}
          >
            {scan.isPending ? 'Détection…' : 'Détecter les jeux'}
          </Button>
          <Button size="sm" onClick={() => openGameForm({ mode: 'create' })}>
            + Ajouter un jeu
          </Button>
        </span>
      </header>

      {total === 0 && games.isSuccess ? (
        <div
          data-testid="library-empty"
          className="flex-1 flex flex-col items-center justify-center gap-4 rounded-lg border-[1.5px] border-dashed border-ink-500 text-center"
        >
          <div className="font-display font-bold text-2xl text-text-hi">
            Aucun jeu pour l’instant
          </div>
          <p className="max-w-md text-text-mid">
            Détectez les jeux de vos launchers et dossiers, ou ajoutez-en un à la main.
          </p>
          <div className="flex gap-2.5">
            <Button onClick={() => void scan.run()}>Détecter mes jeux</Button>
            <Button variant="secondary" onClick={() => openGameForm({ mode: 'create' })}>
              Ajouter un jeu
            </Button>
          </div>
        </div>
      ) : (
        <>
          <FilterBar />
          {shown.length === 0 ? (
            <p data-testid="no-match" className="py-10 text-center text-text-lo">
              Aucun jeu ne correspond à ces filtres.
            </p>
          ) : layout === 'list' ? (
            <GameList games={shown} onOpen={open} onPlay={play} onContextMenu={contextMenu} />
          ) : (
            <GameGrid
              games={shown}
              coverSize={settings.data?.coverSize ?? 'md'}
              onOpen={open}
              onPlay={play}
              onContextMenu={contextMenu}
            />
          )}
        </>
      )}
    </section>
  )
}
