import { useState } from 'react'
import type { Achievement, Game } from '@shared/models'
import { useGameAchievements } from '@renderer/lib/queries'
import { formatFullDate } from '@shared/format'
import { PanelState } from './common'

const PREVIEW = 30

function percentLabel(percent: number): string {
  return `${percent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des joueurs`
}

function Row({ achievement }: { achievement: Achievement }) {
  const locked = achievement.unlocked === false
  const secret = locked && achievement.hidden && !achievement.description
  return (
    <li
      data-testid="achievement"
      data-unlocked={achievement.unlocked === null ? undefined : String(achievement.unlocked)}
      className="flex items-center gap-3 p-2.5 rounded-lg bg-ink-800 border border-ink-600"
    >
      {achievement.iconUrl ? (
        <img
          src={achievement.iconUrl}
          alt=""
          loading="lazy"
          className={`w-11 h-11 rounded flex-none ${locked ? 'opacity-60' : ''}`}
        />
      ) : (
        <div className="w-11 h-11 rounded flex-none bg-ink-700" />
      )}
      <div className="min-w-0 flex flex-col">
        <b className={`font-semibold truncate ${locked ? 'text-text-mid' : 'text-text-hi'}`}>
          {achievement.name}
        </b>
        <span className="text-sm text-text-lo truncate">
          {secret ? 'Succès secret' : (achievement.description ?? '')}
        </span>
      </div>
      <div className="ml-auto flex-none flex flex-col items-end text-xs text-text-lo">
        {achievement.unlocked && (
          <span className="text-green-300 font-semibold">
            ✓ {achievement.unlockedAt ? formatFullDate(achievement.unlockedAt) : 'Débloqué'}
          </span>
        )}
        {achievement.percent !== null && <span>{percentLabel(achievement.percent)}</span>}
      </div>
    </li>
  )
}

export function AchievementsPanel({ game }: { game: Game }) {
  const query = useGameAchievements(game, true)
  const [expanded, setExpanded] = useState(false)
  return (
    <PanelState
      query={query}
      isEmpty={(view) => view.total === 0}
      empty="Ce jeu n’a pas de succès Steam."
    >
      {(view) => {
        const shown = expanded ? view.items : view.items.slice(0, PREVIEW)
        const ratio = view.unlocked !== null ? view.unlocked / view.total : null
        return (
          <div className="flex flex-col gap-3 max-w-[760px]">
            {ratio !== null ? (
              <div className="flex flex-col gap-1.5">
                <span data-testid="achievements-progress" className="text-sm text-text-hi">
                  {view.unlocked} / {view.total} succès débloqués · {Math.round(ratio * 100)} %
                </span>
                <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
                  <div className="h-full bg-grad-brand" style={{ width: `${ratio * 100}%` }} />
                </div>
              </div>
            ) : (
              <span className="text-sm text-text-mid">{view.total} succès</span>
            )}
            {view.note && (
              <p data-testid="achievements-note" className="text-sm text-text-lo">
                {view.note}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {shown.map((a) => (
                <Row key={a.id} achievement={a} />
              ))}
            </ul>
            {view.items.length > PREVIEW && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="self-start text-xs text-text-lo hover:text-text-hi cursor-pointer"
              >
                {expanded ? 'Réduire' : `Afficher les ${view.items.length}`}
              </button>
            )}
          </div>
        )
      }}
    </PanelState>
  )
}
