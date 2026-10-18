import { useMemo } from 'react'
import type { Game } from '@shared/models'
import { pluralize } from '@shared/format'
import { GameGrid } from '@renderer/components/game/GameGrid'
import { Button } from '@renderer/components/ui/Button'
import { usePlay } from '@renderer/lib/actions'
import { useGames } from '@renderer/lib/queries'
import { useUiStore, type ListRoute } from '@renderer/stores/ui'

const titles: Record<ListRoute['name'], string> = {
  library: 'Bibliothèque',
  favorites: 'Favoris',
  recent: 'Récents',
  source: 'Source'
}

function gamesFor(route: ListRoute, games: Game[]): Game[] {
  const visible = games.filter((g) => !g.hidden)
  switch (route.name) {
    case 'favorites':
      return visible.filter((g) => g.favorite)
    case 'recent':
      return visible
        .filter((g) => g.lastPlayedAt !== null)
        .sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)
    case 'source':
      return visible.filter((g) => g.source === route.source)
    default:
      return visible
  }
}

// Mockup 01 — library header + cover grid.
export function LibraryView({ route }: { route: ListRoute }) {
  const games = useGames()
  const navigate = useUiStore((s) => s.navigate)
  const openGameForm = useUiStore((s) => s.openGameForm)
  const play = usePlay()

  const shown = useMemo(() => gamesFor(route, games.data ?? []), [route, games.data])
  const total = games.data?.length ?? 0

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-[18px] px-7 py-6">
      <header className="flex items-baseline gap-3">
        <h1 className="font-display font-bold text-[28px] tracking-[-.02em] text-text-hi">
          {titles[route.name]}
        </h1>
        <span data-testid="game-count" className="text-text-lo">
          {pluralize(shown.length, 'jeu', 'jeux')}
        </span>
        <span className="ml-auto self-center flex gap-2">
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
            Ajoutez un jeu à la main en choisissant son exécutable.
          </p>
          <Button onClick={() => openGameForm({ mode: 'create' })}>Ajouter un jeu</Button>
        </div>
      ) : (
        <GameGrid
          games={shown}
          coverSize="md"
          onOpen={(game) => navigate({ name: 'game', id: game.id })}
          onPlay={play}
        />
      )}
    </section>
  )
}
