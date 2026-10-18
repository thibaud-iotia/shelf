import { useRef, type KeyboardEvent, type MouseEvent } from 'react'
import type { CoverSize, Game } from '@shared/models'
import { useUiStore } from '@renderer/stores/ui'
import { GameCard } from './GameCard'

const minWidth: Record<CoverSize, number> = { sm: 112, md: 140, lg: 190 }

interface GameGridProps {
  games: Game[]
  coverSize: CoverSize
  onOpen: (game: Game) => void
  onPlay: (game: Game) => void
  onContextMenu?: (event: MouseEvent, game: Game) => void
  trailing?: React.ReactNode
}

function columnCount(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1
}

/**
 * Cover grid with a roving focus: one tab stop, arrows move the selection,
 * Enter opens the detail, Ctrl/⌘+Enter launches.
 */
export function GameGrid({
  games,
  coverSize,
  onOpen,
  onPlay,
  onContextMenu,
  trailing
}: GameGridProps) {
  const grid = useRef<HTMLDivElement>(null)
  const selectedId = useUiStore((s) => s.selectedGameId)
  const select = useUiStore((s) => s.select)
  const selectedIndex = Math.max(
    0,
    games.findIndex((g) => g.id === selectedId)
  )

  const focusIndex = (index: number) => {
    const target = games[index]
    if (!target || !grid.current) return
    select(target.id)
    grid.current
      .querySelector<HTMLButtonElement>(`[data-game-id="${target.id}"] [data-card-button]`)
      ?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, game: Game) => {
    const index = games.indexOf(game)
    const columns = grid.current ? columnCount(grid.current) : 1
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
      Home: -index,
      End: games.length - 1 - index
    }
    if (event.key in moves) {
      event.preventDefault()
      focusIndex(Math.min(games.length - 1, Math.max(0, index + moves[event.key]!)))
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onPlay(game)
    }
  }

  return (
    <div
      ref={grid}
      role="list"
      aria-label="Jeux"
      className="grid gap-[18px]"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth[coverSize]}px, 1fr))` }}
    >
      {games.map((game, index) => (
        <div role="listitem" key={game.id}>
          <GameCard
            game={game}
            selected={game.id === selectedId}
            tabIndex={index === selectedIndex ? 0 : -1}
            onOpen={onOpen}
            onPlay={onPlay}
            onFocus={(g) => select(g.id)}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
          />
        </div>
      ))}
      {trailing}
    </div>
  )
}
