import type { KeyboardEvent, MouseEvent } from 'react'
import type { Game } from '@shared/models'
import { useIsRunning } from '@renderer/stores/running'
import { CoverArt } from './CoverArt'

export const GAME_DRAG_TYPE = 'application/x-shelf-game'

interface GameCardProps {
  game: Game
  selected: boolean
  tabIndex: number
  onOpen: (game: Game) => void
  onPlay: (game: Game) => void
  onFocus: (game: Game) => void
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>, game: Game) => void
  onContextMenu?: (event: MouseEvent, game: Game) => void
}

/** Mockup 01 cover: 3:4, radius 14, title over a bottom gradient, ♥ top-right. */
export function GameCard({
  game,
  selected,
  tabIndex,
  onOpen,
  onPlay,
  onFocus,
  onKeyDown,
  onContextMenu
}: GameCardProps) {
  const running = useIsRunning(game.id)
  const dimmed = game.installState === 'not_installed'

  return (
    <article
      data-testid="game-card"
      data-game-id={game.id}
      aria-label={game.title}
      className="group relative"
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        onContextMenu(e, game)
      }}
    >
      <button
        type="button"
        data-card-button
        aria-label={game.title}
        tabIndex={tabIndex}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(GAME_DRAG_TYPE, String(game.id))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => onOpen(game)}
        onFocus={() => onFocus(game)}
        onKeyDown={(e) => onKeyDown?.(e, game)}
        className={`relative block w-full aspect-[3/4] rounded-md overflow-hidden cursor-pointer outline-none transition-[box-shadow,opacity,transform] duration-[var(--dur-fast)] ${
          selected ? 'shadow-[0_0_0_3px_var(--brand),var(--glow-brand)]' : 'hover:-translate-y-0.5'
        } ${dimmed ? 'opacity-40 hover:opacity-70' : ''}`}
      >
        <CoverArt title={game.title} url={game.coverUrl} />
        <span className="absolute inset-x-0 bottom-0 px-3 pt-7 pb-3 bg-[linear-gradient(transparent,rgba(8,8,12,.88))] text-left font-display font-bold text-[15px] leading-tight text-white">
          {game.title}
        </span>
        {game.favorite && (
          <span
            aria-hidden
            data-testid="favorite-mark"
            className="absolute top-2.5 right-3 text-red-300"
          >
            ♥
          </span>
        )}
        {running && (
          <span
            data-testid="running-badge"
            className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(8,8,12,.75)] text-[11px] font-semibold text-green-300"
          >
            <i className="w-1.5 h-1.5 rounded-full bg-green-300 animate-pulse" />
            En cours
          </span>
        )}
      </button>
      {!running && game.installState !== 'not_installed' && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Jouer à ${game.title}`}
          onClick={() => onPlay(game)}
          className="absolute bottom-12 right-2.5 w-10 h-10 rounded-full bg-grad-brand text-white shadow-glow-brand opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
        >
          ▶
        </button>
      )}
    </article>
  )
}
