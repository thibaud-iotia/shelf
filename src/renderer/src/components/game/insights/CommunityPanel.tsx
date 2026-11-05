import { useState } from 'react'
import { COMMUNITY_KINDS, type CommunityKind, type Game } from '@shared/models'
import { Chip } from '@renderer/components/ui/Chip'
import { useGameCommunity } from '@renderer/lib/queries'
import { formatCount, formatFullDate } from '@shared/format'
import { ExternalLink, PanelState } from './common'

const LABELS: Record<CommunityKind, string> = {
  screenshots: 'Captures',
  artwork: 'Artworks',
  guides: 'Guides'
}

export function CommunityPanel({ game }: { game: Game }) {
  const [kind, setKind] = useState<CommunityKind>('screenshots')
  const items = useGameCommunity(game, kind, true)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2" role="group" aria-label="Type de contenu">
        {COMMUNITY_KINDS.map((k) => (
          <Chip key={k} active={k === kind} onClick={() => setKind(k)}>
            {LABELS[k]}
          </Chip>
        ))}
        <span className="self-center ml-2 text-xs text-text-lo">
          Tendances des 30 derniers jours
        </span>
      </div>
      <PanelState
        query={items}
        isEmpty={(list) => list.length === 0}
        empty="Rien de partagé récemment par la communauté."
      >
        {(list) =>
          kind === 'guides' ? (
            <ul data-testid="community" className="flex flex-col gap-2 max-w-[760px]">
              {list.map((item) => (
                <li key={item.id}>
                  <ExternalLink
                    href={item.url}
                    className="flex gap-3 items-center p-3 rounded-lg bg-ink-800 border border-ink-600 hover:border-ink-400"
                  >
                    {item.previewUrl && (
                      <img
                        src={item.previewUrl}
                        alt=""
                        loading="lazy"
                        className="w-12 h-12 rounded object-cover flex-none"
                      />
                    )}
                    <span className="min-w-0 flex flex-col">
                      <b className="text-text-hi font-semibold truncate">{item.title}</b>
                      {item.description && (
                        <span className="text-sm text-text-mid line-clamp-2">
                          {item.description}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto flex-none text-xs text-text-lo">
                      👍 {formatCount(item.votesUp)}
                    </span>
                  </ExternalLink>
                </li>
              ))}
            </ul>
          ) : (
            <ul
              data-testid="community"
              className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3"
            >
              {list.map((item) => (
                <li key={item.id}>
                  <ExternalLink
                    href={item.url}
                    title={item.title}
                    className="group block rounded-lg overflow-hidden bg-ink-800 border border-ink-600 hover:border-ink-400"
                  >
                    <div className="aspect-video bg-ink-700">
                      {item.previewUrl && (
                        <img
                          src={item.previewUrl}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-lo">
                      <span className="truncate text-text-mid">{item.title}</span>
                      <span className="ml-auto flex-none">
                        👍 {formatCount(item.votesUp)} · {formatFullDate(item.createdAt)}
                      </span>
                    </div>
                  </ExternalLink>
                </li>
              ))}
            </ul>
          )
        }
      </PanelState>
    </div>
  )
}
