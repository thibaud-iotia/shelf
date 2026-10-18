import type { ReactNode } from 'react'
import { GAME_SOURCES, SOURCE_LABELS } from '@shared/domain'
import type { Game } from '@shared/models'
import { useGames } from '@renderer/lib/queries'
import { useRunningStore } from '@renderer/stores/running'
import { useUiStore, type Route } from '@renderer/stores/ui'

// Mockup 01 — "navigation hybride" sidebar (248px, ink-900).

function isActive(current: Route, target: Route): boolean {
  if (current.name !== target.name) return false
  if (current.name === 'source' && target.name === 'source') return current.source === target.source
  if (current.name === 'collection' && target.name === 'collection') return current.id === target.id
  return true
}

interface NavItemProps {
  route: Route
  label: string
  count?: number
  dot?: boolean
  children?: ReactNode
}

function NavItem({ route, label, count, dot }: NavItemProps) {
  const active = useUiStore((s) => isActive(s.route, route))
  const navigate = useUiStore((s) => s.navigate)
  return (
    <button
      type="button"
      onClick={() => navigate(route)}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 px-3 py-[9px] rounded-[12px] text-sm text-left cursor-pointer transition-colors ${
        active ? 'bg-brand-subtle text-white font-semibold' : 'text-text-mid hover:bg-ink-800'
      }`}
    >
      {dot && <i className="w-2 h-2 rounded-full bg-green-300" />}
      {label}
      {count !== undefined && (
        <span className="ml-auto font-mono text-xs font-medium opacity-70">{count}</span>
      )}
    </button>
  )
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[.12em] text-text-lo">
      {children}
    </div>
  )
}

function RunningGames({ games }: { games: Game[] }) {
  const ids = useRunningStore((s) => s.ids)
  const navigate = useUiStore((s) => s.navigate)
  const running = games.filter((g) => ids.includes(g.id))
  if (running.length === 0) return null
  return (
    <div data-testid="running-list" className="flex flex-col gap-1 mb-2">
      <SectionHeading>EN COURS</SectionHeading>
      {running.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => navigate({ name: 'game', id: g.id })}
          className="flex items-center gap-2.5 px-3 py-2 rounded-[12px] text-sm text-green-300 bg-accent-subtle cursor-pointer text-left"
        >
          <i className="w-2 h-2 rounded-full bg-green-300 animate-pulse" />
          <span className="truncate">{g.title}</span>
        </button>
      ))}
    </div>
  )
}

export function Sidebar({ extra }: { extra?: ReactNode }) {
  const games = useGames()
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const all = (games.data ?? []).filter((g) => !g.hidden)
  const favorites = all.filter((g) => g.favorite).length
  const sources = GAME_SOURCES.map((source) => ({
    source,
    count: all.filter((g) => g.source === source).length
  })).filter((s) => s.count > 0)

  return (
    <nav
      aria-label="Navigation principale"
      className="w-[248px] flex-none flex flex-col gap-[3px] px-3.5 pt-[var(--sidebar-top)] pb-[18px] bg-ink-900 border-r border-ink-600 overflow-y-auto"
    >
      <div className="flex items-center gap-2.5 mb-3.5 px-1.5">
        <div className="w-[30px] h-[30px] rounded-[9px] bg-grad-brand flex items-center justify-center font-display font-bold text-base text-white">
          S
        </div>
        <b className="font-display font-bold text-lg text-text-hi">Shelf</b>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex items-center gap-2 px-3 py-[9px] mb-2.5 rounded-[12px] bg-ink-800 border border-ink-600 text-[13px] text-text-lo cursor-pointer hover:border-ink-500"
      >
        Rechercher
        <span className="ml-auto font-mono text-[11px] font-medium px-1.5 py-0.5 rounded-xs bg-ink-700">
          Ctrl K
        </span>
      </button>

      <NavItem route={{ name: 'library' }} label="Bibliothèque" count={all.length} />
      <NavItem route={{ name: 'favorites' }} label="Favoris" count={favorites} />
      <NavItem route={{ name: 'recent' }} label="Récents" />

      {sources.length > 0 && (
        <>
          <SectionHeading>SOURCES</SectionHeading>
          {sources.map(({ source, count }) => (
            <NavItem
              key={source}
              route={{ name: 'source', source }}
              label={SOURCE_LABELS[source]}
              count={count}
              dot
            />
          ))}
        </>
      )}

      {extra}

      <div className="mt-auto pt-3 flex flex-col">
        <RunningGames games={games.data ?? []} />
        <NavItem route={{ name: 'settings', section: 'metadata' }} label="Réglages" />
      </div>
    </nav>
  )
}
