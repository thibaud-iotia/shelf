import { SOURCE_LABELS } from '@shared/domain'
import type { DetailTab } from '@renderer/lib/detail'
import { useCollections } from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

// Shared by the game page and the store page of a game to buy.

/** Where "back" leads: the view the game was opened from. */
function useBackLabel(): string {
  const previous = useUiStore((s) => s.history.at(-1))
  const collections = useCollections()
  switch (previous?.name) {
    case 'favorites':
      return 'Favoris'
    case 'recent':
      return 'Récents'
    case 'source':
      return SOURCE_LABELS[previous.source]
    case 'collection':
      return collections.data?.find((c) => c.id === previous.id)?.name ?? 'Collection'
    case 'game':
      return 'Jeu précédent'
    case 'import':
      return 'Import'
    case 'settings':
      return 'Réglages'
    case 'store':
      return 'Boutique'
    case 'storeGame':
      return 'Jeu précédent'
    default:
      return 'Bibliothèque'
  }
}

/**
 * Way back to the gallery: a pill that stays pinned under the title bar while the page
 * scrolls, readable over any artwork. Escape and the mouse "back" button do the same.
 */
export function BackBar({ title }: { title: string }) {
  const back = useUiStore((s) => s.back)
  const label = useBackLabel()
  return (
    <div className="sticky top-2.5 z-20 h-0">
      <nav
        aria-label="Fil d’Ariane"
        className="absolute left-10 top-0 flex items-center gap-1 h-10 p-1 pr-4 max-w-[calc(100%-80px)] rounded-full bg-black/70 backdrop-blur-md border border-white/15 shadow-lg"
      >
        <button
          type="button"
          onClick={back}
          aria-label={`Retour : ${label}`}
          title="Retour (Échap)"
          className="app-no-drag group flex-none flex items-center gap-2 h-8 pl-2 pr-2.5 rounded-full text-sm font-semibold text-white hover:bg-white/15 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-brand"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3 5 8l5 5" />
          </svg>
          {label}
          <kbd
            aria-hidden="true"
            className="ml-1 font-mono text-[10px] font-medium px-1.5 py-px rounded-xs bg-white/10 text-white/70"
          >
            Échap
          </kbd>
        </button>
        <span aria-hidden="true" className="flex-none w-px h-4 mx-1.5 bg-white/25" />
        <span
          data-testid="breadcrumb-title"
          title={title}
          className="truncate text-sm font-semibold text-white"
        >
          {title}
        </span>
      </nav>
    </div>
  )
}

export function TabBar({
  tabs,
  active,
  onChange
}: {
  tabs: { id: DetailTab; label: string }[]
  active: DetailTab
  onChange: (tab: DetailTab) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Sections de la fiche"
      className="flex gap-6 border-b border-ink-600"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={`-mb-px pb-2.5 text-sm font-semibold border-b-2 cursor-pointer transition-colors ${
            tab.id === active
              ? 'border-brand text-text-hi'
              : 'border-transparent text-text-lo hover:text-text-mid'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
