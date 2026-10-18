import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { GAME_SOURCES, SOURCE_LABELS } from '@shared/domain'
import { formatPlaytimeShort } from '@shared/format'
import { fuzzyScore, searchGames } from '@shared/library'
import type { Game } from '@shared/models'
import { CoverArt } from '@renderer/components/game/CoverArt'
import { usePlay, useScanFolder, useStartScan } from '@renderer/lib/actions'
import { useCollections, useGames, useSyncAccounts } from '@renderer/lib/queries'
import { useUiStore, type Route } from '@renderer/stores/ui'
import { FILTER_INPUT_ID } from './FilterBar'

type Entry =
  | { kind: 'game'; id: string; game: Game }
  | { kind: 'goto'; id: string; label: string; route: Route }
  | { kind: 'action'; id: string; label: string; run: () => void }

function Section({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1.5 text-[11px] font-semibold tracking-[.12em] text-text-lo">
      {children}
    </div>
  )
}

// Mockup 02 — ⌘K palette: games, "aller à", actions.
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen)
  return open ? <PaletteBody /> : null
}

function PaletteBody() {
  const setOpen = useUiStore((s) => s.setPaletteOpen)
  const navigate = useUiStore((s) => s.navigate)
  const openGameForm = useUiStore((s) => s.openGameForm)
  const games = useGames()
  const collections = useCollections()
  const play = usePlay()
  const scan = useStartScan()
  const scanFolder = useScanFolder()
  const sync = useSyncAccounts()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const sections = useMemo(() => {
    const close = () => setOpen(false)
    const gameEntries: Entry[] = (
      query.trim()
        ? searchGames(games.data ?? [], query, 6)
        : [...(games.data ?? [])]
            .filter((g) => g.lastPlayedAt && !g.hidden)
            .sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)
            .slice(0, 5)
    ).map((game) => ({ kind: 'game', id: `game-${game.id}`, game }))

    const destinations: { label: string; route: Route }[] = [
      { label: 'Bibliothèque', route: { name: 'library' } },
      { label: 'Favoris', route: { name: 'favorites' } },
      { label: 'Récents', route: { name: 'recent' } },
      ...(collections.data ?? []).map((c) => ({
        label: `Collection « ${c.name} »`,
        route: { name: 'collection', id: c.id } as Route
      })),
      ...GAME_SOURCES.map((source) => ({
        label: `Source ${SOURCE_LABELS[source]}`,
        route: { name: 'source', source } as Route
      })),
      { label: 'Réglages', route: { name: 'settings', section: 'metadata' } },
      { label: 'Comptes', route: { name: 'settings', section: 'accounts' } }
    ]
    const actions: { label: string; run: () => void }[] = [
      { label: 'Ajouter un jeu…', run: () => openGameForm({ mode: 'create' }) },
      { label: 'Scanner un dossier…', run: () => void scanFolder.pick() },
      { label: 'Détecter les jeux des launchers', run: () => void scan.run() },
      { label: 'Synchroniser les comptes', run: () => sync.mutate([undefined]) }
    ]
    const match = <T extends { label: string }>(items: T[]) =>
      query.trim() ? items.filter((i) => fuzzyScore(query, i.label) !== null) : items
    const limit = query.trim() ? 4 : 3

    return [
      { title: 'JEUX', entries: gameEntries },
      {
        title: 'ALLER À',
        entries: match(destinations)
          .slice(0, limit)
          .map((d): Entry => ({
            kind: 'goto',
            id: `goto-${d.label}`,
            label: d.label,
            route: d.route
          }))
      },
      {
        title: 'ACTIONS',
        entries: match(actions)
          .slice(0, limit)
          .map((a): Entry => ({
            kind: 'action',
            id: `action-${a.label}`,
            label: a.label,
            run: () => {
              close()
              a.run()
            }
          }))
      }
    ].filter((s) => s.entries.length > 0)
  }, [query, games.data, collections.data, setOpen, openGameForm, scanFolder, scan, sync])

  const flat = sections.flatMap((s) => s.entries)
  const current = flat[Math.min(active, flat.length - 1)]

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const execute = (entry: Entry | undefined, detail = false) => {
    if (!entry) return
    if (entry.kind === 'game') {
      setOpen(false)
      if (detail || entry.game.installState === 'not_installed') {
        navigate({ name: 'game', id: entry.game.id })
      } else void play(entry.game)
    } else if (entry.kind === 'goto') {
      setOpen(false)
      navigate(entry.route)
    } else entry.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(current)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (current?.kind === 'game') execute(current, true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === '/' && !query) {
      e.preventDefault()
      setOpen(false)
      requestAnimationFrame(() => document.getElementById(FILTER_INPUT_ID)?.focus())
    }
  }

  let index = -1
  return (
    <div
      className="fixed inset-0 z-50 flex justify-center items-start pt-[14vh] bg-[rgba(8,8,12,.55)] backdrop-blur-[8px]"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        className="w-[640px] max-w-[calc(100vw-32px)] flex flex-col rounded-lg bg-ink-800 border border-ink-600 shadow-[0_30px_90px_rgba(0,0,0,.65)] overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink-600">
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-xs bg-ink-700 text-text-lo">
            Ctrl K
          </span>
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={current ? `palette-${current.id}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Rechercher un jeu, une collection, une action…"
            className="flex-1 bg-transparent outline-none text-lg text-text-hi placeholder:text-text-lo"
          />
        </div>
        <div
          ref={list}
          id="palette-list"
          role="listbox"
          className="max-h-[420px] overflow-auto pb-2"
        >
          {sections.map((section) => (
            <div key={section.title}>
              <Section>{section.title}</Section>
              {section.entries.map((entry) => {
                index++
                const i = index
                const selected = i === Math.min(active, flat.length - 1)
                return (
                  <div
                    key={entry.id}
                    id={`palette-${entry.id}`}
                    role="option"
                    aria-selected={selected}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => execute(entry)}
                    className={`mx-2 flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer ${
                      selected ? 'bg-brand-subtle' : ''
                    }`}
                  >
                    {entry.kind === 'game' ? (
                      <>
                        <div className="relative w-8 aspect-[3/4] rounded-[6px] overflow-hidden flex-none">
                          <CoverArt title={entry.game.title} url={entry.game.coverUrl} />
                        </div>
                        <div className="min-w-0">
                          <b className="block truncate text-text-hi">{entry.game.title}</b>
                          <span className="text-xs text-text-lo">
                            {[entry.game.developer, formatPlaytimeShort(entry.game.playtimeSec)]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <span className="ml-auto text-xs text-text-lo whitespace-nowrap">
                          {SOURCE_LABELS[entry.game.source]}
                          {selected && (
                            <>
                              {' · '}
                              <b className="text-red-200">
                                {entry.game.installState === 'not_installed'
                                  ? '↵ Détail'
                                  : '↵ Jouer'}
                              </b>
                            </>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-text-hi">{entry.label}</span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {flat.length === 0 && <p className="px-5 py-6 text-text-lo">Aucun résultat.</p>}
        </div>
        <div className="flex gap-5 px-5 py-3 border-t border-ink-600 text-xs text-text-lo">
          <span>↑↓ naviguer</span>
          <span>↵ lancer</span>
          <span>Tab détail</span>
          <span>/ filtre</span>
          <span className="ml-auto">Échap fermer</span>
        </div>
      </div>
    </div>
  )
}
