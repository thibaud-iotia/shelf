import type { MouseEvent } from 'react'
import { INSTALL_STATE_LABELS, SOURCE_LABELS } from '@shared/domain'
import { formatDay, formatPlaytimeShort } from '@shared/format'
import type { Game } from '@shared/models'
import { useRunningStore } from '@renderer/stores/running'
import { useUiStore } from '@renderer/stores/ui'
import { CoverArt } from './CoverArt'
import { GAME_DRAG_TYPE } from './GameCard'

interface GameListProps {
  games: Game[]
  onOpen: (game: Game) => void
  onPlay: (game: Game) => void
  onContextMenu?: (event: MouseEvent, game: Game) => void
}

/** List layout of the library: one row per game, same actions as the grid. */
export function GameList({ games, onOpen, onPlay, onContextMenu }: GameListProps) {
  const running = useRunningStore((s) => s.ids)
  const selectedId = useUiStore((s) => s.selectedGameId)
  const select = useUiStore((s) => s.select)

  return (
    <div role="table" aria-label="Jeux" className="flex flex-col">
      <div
        role="row"
        className="grid grid-cols-[48px_1fr_110px_120px_90px_120px_90px] gap-4 px-3 pb-2 text-[11px] font-semibold tracking-[.12em] text-text-lo"
      >
        <span role="columnheader" />
        <span role="columnheader">TITRE</span>
        <span role="columnheader">SOURCE</span>
        <span role="columnheader">ÉTAT</span>
        <span role="columnheader">TEMPS</span>
        <span role="columnheader">DERNIÈRE</span>
        <span role="columnheader" />
      </div>
      {games.map((game) => (
        <div
          key={game.id}
          role="row"
          data-testid="game-row"
          tabIndex={0}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(GAME_DRAG_TYPE, String(game.id))}
          onClick={() => onOpen(game)}
          onFocus={() => select(game.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.ctrlKey || e.metaKey) onPlay(game)
              else onOpen(game)
            }
          }}
          onContextMenu={(e) => {
            if (!onContextMenu) return
            e.preventDefault()
            onContextMenu(e, game)
          }}
          className={`grid grid-cols-[48px_1fr_110px_120px_90px_120px_90px] gap-4 items-center px-3 py-2 rounded-md cursor-pointer outline-none hover:bg-ink-800 focus-visible:bg-ink-800 ${
            selectedId === game.id ? 'bg-ink-800' : ''
          } ${game.installState === 'not_installed' ? 'opacity-50' : ''}`}
        >
          <div role="cell" className="relative w-9 aspect-[3/4] rounded-[6px] overflow-hidden">
            <CoverArt title={game.title} url={game.coverUrl} />
          </div>
          <div role="cell" className="min-w-0">
            <div className="truncate font-semibold text-text-hi">
              {game.favorite && <span className="text-red-300 mr-1.5">♥</span>}
              {game.title}
            </div>
            {game.developer && (
              <div className="truncate text-xs text-text-lo">{game.developer}</div>
            )}
          </div>
          <span role="cell" className="text-sm text-text-mid">
            {SOURCE_LABELS[game.source]}
          </span>
          <span role="cell" className="text-sm text-text-mid">
            {running.includes(game.id) ? (
              <span className="text-green-300">● En cours</span>
            ) : (
              INSTALL_STATE_LABELS[game.installState]
            )}
          </span>
          <span role="cell" className="font-mono text-xs text-text-mid">
            {formatPlaytimeShort(game.playtimeSec)}
          </span>
          <span role="cell" className="text-sm text-text-lo">
            {game.lastPlayedAt ? formatDay(game.lastPlayedAt) : '—'}
          </span>
          <span role="cell" className="text-right">
            {game.installState !== 'not_installed' && !running.includes(game.id) && (
              <button
                type="button"
                aria-label={`Jouer à ${game.title}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onPlay(game)
                }}
                className="px-3 py-1 rounded-full bg-grad-brand text-white text-xs font-semibold cursor-pointer"
              >
                ▶ Jouer
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
