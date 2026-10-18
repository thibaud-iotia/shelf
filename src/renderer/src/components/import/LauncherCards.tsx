import type { GameSourceId } from '@shared/domain'
import { pluralize } from '@shared/format'
import type { LauncherStatus } from '@shared/models'

const tiles: Record<GameSourceId, { letter: string; background: string }> = {
  steam: { letter: 'S', background: 'linear-gradient(160deg,#1b6fa8,#12263a)' },
  epic: { letter: 'E', background: 'linear-gradient(160deg,#4a4a5e,#16161f)' },
  gog: { letter: 'G', background: 'linear-gradient(160deg,#8a45b8,#2a1438)' },
  itch: { letter: 'i', background: 'linear-gradient(160deg,#fa5c5c,#3a1414)' },
  manual: { letter: 'M', background: 'var(--ink-700)' }
}

interface LauncherCardsProps {
  launchers: LauncherStatus[]
  enabled: GameSourceId[]
  onToggle: (source: GameSourceId) => void
}

/** Mockup 05: detected = green border + glow + "✓ Inclus", absent = dashed at 0.7. */
export function LauncherCards({ launchers, enabled, onToggle }: LauncherCardsProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
      {launchers.map((l) => {
        const included = l.available && enabled.includes(l.source)
        const tile = tiles[l.source]
        return (
          <button
            key={l.source}
            type="button"
            data-testid={`launcher-${l.source}`}
            disabled={!l.available}
            aria-pressed={l.available ? included : undefined}
            onClick={() => onToggle(l.source)}
            className={`flex flex-col items-center gap-2 px-[18px] py-7 rounded-lg bg-ink-800 transition-[box-shadow,border-color,opacity] ${
              l.available
                ? included
                  ? 'border-[1.5px] border-green-300 shadow-glow-accent cursor-pointer'
                  : 'border-[1.5px] border-ink-500 cursor-pointer'
                : 'border-[1.5px] border-dashed border-ink-500 opacity-70 cursor-default'
            }`}
          >
            <div
              className="w-14 h-14 rounded-[16px] flex items-center justify-center font-display font-bold text-2xl text-white"
              style={{ background: l.available ? tile.background : 'var(--ink-700)' }}
            >
              {tile.letter}
            </div>
            <b className="font-display font-bold text-lg text-text-hi">{l.name}</b>
            <span className="text-[13px] text-text-lo">
              {l.available ? pluralize(l.gameCount, 'jeu', 'jeux') : 'non trouvé'}
            </span>
            <span
              className={`mt-2 text-[13px] font-semibold ${included ? 'text-green-300' : 'text-text-lo'}`}
            >
              {l.available ? (included ? '✓ Inclus' : 'Exclu') : 'Non détecté'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
