import type { ReactNode } from 'react'
import { useUiStore, type View } from '@renderer/stores/ui'

// Mockup 01 — "navigation hybride" sidebar (248px, ink-900).

function NavItem({ view, label, count }: { view: View; label: string; count?: number }) {
  const active = useUiStore((s) => s.view === view)
  const setView = useUiStore((s) => s.setView)
  return (
    <button
      type="button"
      onClick={() => setView(view)}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 px-3 py-[9px] rounded-[12px] text-sm text-left cursor-pointer transition-colors ${
        active ? 'bg-brand-subtle text-white font-semibold' : 'text-text-mid hover:bg-ink-800'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="ml-auto font-mono text-xs font-medium opacity-70">{count}</span>
      )}
    </button>
  )
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[.12em] text-text-lo">
      {children}
    </div>
  )
}

export function Sidebar({ gameCount }: { gameCount: number }) {
  return (
    <nav
      aria-label="Navigation principale"
      className="w-[248px] flex-none flex flex-col gap-[3px] px-3.5 pt-[var(--sidebar-top)] pb-[18px] bg-ink-900 border-r border-ink-600"
    >
      <div className="flex items-center gap-2.5 mb-3.5 px-1.5">
        <div className="w-[30px] h-[30px] rounded-[9px] bg-grad-brand flex items-center justify-center font-display font-bold text-base text-white">
          S
        </div>
        <b className="font-display font-bold text-lg text-text-hi">Shelf</b>
      </div>

      <div className="flex items-center gap-2 px-3 py-[9px] mb-2.5 rounded-[12px] bg-ink-800 border border-ink-600 text-[13px] text-text-lo">
        Rechercher
        <span className="ml-auto font-mono text-[11px] font-medium px-1.5 py-0.5 rounded-xs bg-ink-700">
          Ctrl K
        </span>
      </div>

      <NavItem view="library" label="Bibliothèque" count={gameCount} />
      <NavItem view="favorites" label="Favoris" />
      <NavItem view="recent" label="Récents" />

      <SectionHeading>SOURCES</SectionHeading>
      <SectionHeading>COLLECTIONS</SectionHeading>

      <div className="mt-auto flex flex-col">
        <NavItem view="settings" label="Réglages" />
      </div>
    </nav>
  )
}
