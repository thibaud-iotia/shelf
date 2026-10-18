import { useEffect, useRef, useState } from 'react'
import { Chip } from '@renderer/components/ui/Chip'
import { useTags } from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

export const FILTER_INPUT_ID = 'library-filter'

function TagMenu() {
  const tags = useTags()
  const tagFilter = useUiStore((s) => s.tagFilter)
  const setTagFilter = useUiStore((s) => s.setTagFilter)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <Chip active={!!tagFilter} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        {tagFilter ? `# ${tagFilter}` : 'Tag'} ▾
      </Chip>
      {open && (
        <div
          role="menu"
          className="absolute z-30 top-full mt-2 min-w-[200px] max-h-[320px] overflow-auto p-1.5 rounded-md bg-ink-800 border border-ink-600 shadow-[0_16px_48px_rgba(0,0,0,.5)]"
        >
          {tagFilter && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setTagFilter(null)
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 rounded-sm text-sm text-text-lo hover:bg-ink-700 cursor-pointer"
            >
              Tous les tags
            </button>
          )}
          {(tags.data ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={tagFilter === t.name}
              onClick={() => {
                setTagFilter(t.name)
                setOpen(false)
              }}
              className="w-full flex text-left px-3 py-2 rounded-sm text-sm text-text-mid hover:bg-ink-700 cursor-pointer"
            >
              {t.name}
              <span className="ml-auto font-mono text-xs text-text-lo">{t.count}</span>
            </button>
          ))}
          {tags.data?.length === 0 && (
            <p className="px-3 py-2 text-sm text-text-lo">
              Aucun tag : clic droit sur une jaquette pour en ajouter.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Mockup 01 — "Filtrer ce qui est affiché…" (/), grid/list switch, filter chips. */
export function FilterBar() {
  const text = useUiStore((s) => s.filterText)
  const setText = useUiStore((s) => s.setFilterText)
  const layout = useUiStore((s) => s.layout)
  const setLayout = useUiStore((s) => s.setLayout)
  const install = useUiStore((s) => s.installFilter)
  const setInstall = useUiStore((s) => s.setInstallFilter)
  const favoritesOnly = useUiStore((s) => s.favoritesOnly)
  const toggleFavorites = useUiStore((s) => s.toggleFavoritesOnly)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-3 items-center">
        <label className="flex-1 flex items-center gap-2.5 px-4 py-[11px] rounded-md bg-ink-800 border border-ink-500 focus-within:border-brand">
          <span className="sr-only">Filtrer ce qui est affiché</span>
          <input
            id={FILTER_INPUT_ID}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText('')
                e.currentTarget.blur()
              }
            }}
            placeholder="Filtrer ce qui est affiché…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-hi placeholder:text-text-lo"
          />
          <kbd className="font-mono text-[11px] font-medium px-[7px] py-0.5 rounded-xs bg-ink-700 text-text-lo">
            /
          </kbd>
        </label>
        <div
          role="radiogroup"
          aria-label="Affichage"
          className="flex p-1 rounded-[12px] bg-ink-800 border border-ink-500"
        >
          {(
            [
              ['grid', '▦', 'Grille'],
              ['list', '☰', 'Liste']
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={layout === value}
              aria-label={label}
              onClick={() => setLayout(value)}
              className={`px-3 py-1.5 rounded-[9px] cursor-pointer ${
                layout === value ? 'bg-ink-600 text-white' : 'text-text-lo hover:text-text-mid'
              }`}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtres">
        <Chip active={install === 'all'} onClick={() => setInstall('all')}>
          Tous
        </Chip>
        <Chip active={install === 'installed'} onClick={() => setInstall('installed')}>
          Installés
        </Chip>
        <Chip active={install === 'not_installed'} onClick={() => setInstall('not_installed')}>
          Non installés
        </Chip>
        <Chip active={favoritesOnly} onClick={toggleFavorites}>
          ♥ Favoris
        </Chip>
        <TagMenu />
      </div>
    </div>
  )
}
