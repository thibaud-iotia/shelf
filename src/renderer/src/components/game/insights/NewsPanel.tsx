import type { Game } from '@shared/models'
import { useGameNews } from '@renderer/lib/queries'
import { formatFullDate } from '@shared/format'
import { ExternalLink, PanelState } from './common'

export function NewsPanel({ game }: { game: Game }) {
  const news = useGameNews(game, true)
  return (
    <PanelState query={news} isEmpty={(items) => items.length === 0} empty="Aucune actualité.">
      {(items) => (
        <ul data-testid="news" className="flex flex-col gap-3 max-w-[760px]">
          {items.map((item) => (
            <li key={item.id}>
              <ExternalLink
                href={item.url}
                className="flex gap-4 p-3 rounded-lg bg-ink-800 border border-ink-600 hover:border-ink-400 transition-colors"
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    className="w-[180px] aspect-[16/9] flex-none rounded-md object-cover bg-ink-700"
                  />
                ) : (
                  <div className="w-[180px] aspect-[16/9] flex-none rounded-md bg-ink-700" />
                )}
                <div className="min-w-0 flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-xs text-text-lo">
                    <span
                      className={item.official ? 'text-green-300 font-semibold' : 'text-text-mid'}
                    >
                      {item.feed}
                    </span>
                    · {formatFullDate(item.date)}
                  </span>
                  <b className="text-text-hi font-semibold leading-snug">{item.title}</b>
                  <span className="text-sm text-text-mid leading-relaxed line-clamp-3">
                    {item.summary}
                  </span>
                </div>
              </ExternalLink>
            </li>
          ))}
        </ul>
      )}
    </PanelState>
  )
}
