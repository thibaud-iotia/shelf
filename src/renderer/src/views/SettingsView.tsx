import type { ReactNode } from 'react'
import { useAppInfo, usePing } from '@renderer/lib/queries'
import { useUiStore, type SettingsSection } from '@renderer/stores/ui'
import { Card, Row, SectionTitle, StatusPill } from './settings/common'
import { AccountsSection } from './settings/AccountsSection'
import { CacheSection, MetadataSection } from './settings/MetadataSections'
import { FoldersSection, LaunchersSection } from './settings/LibrarySections'

const NAV: { id: SettingsSection; label: string }[] = [
  { id: 'metadata', label: 'Métadonnées' },
  { id: 'accounts', label: 'Comptes' },
  { id: 'launchers', label: 'Launchers' },
  { id: 'folders', label: 'Dossiers et exclusions' },
  { id: 'appearance', label: 'Apparence' },
  { id: 'shortcuts', label: 'Raccourcis' },
  { id: 'system', label: 'Système' },
  { id: 'cache', label: 'Cache' },
  { id: 'about', label: 'À propos' }
]

function AboutSection() {
  const ping = usePing()
  const info = useAppInfo()
  return (
    <>
      <SectionTitle>À propos</SectionTitle>
      <Card
        title="Shelf"
        status={
          <span data-testid="ipc-status">
            <StatusPill ok={ping.isSuccess}>
              {ping.isSuccess ? '✓ IPC connecté' : ping.isError ? 'IPC indisponible' : '…'}
            </StatusPill>
          </span>
        }
      >
        {info.data && (
          <div className="grid grid-cols-2 gap-4">
            <Row label="VERSION" value={info.data.version} testId="app-version" />
            <Row label="ELECTRON" value={info.data.electronVersion} />
            <Row label="DONNÉES" value={info.data.userDataPath} />
            <Row
              label="MIGRATIONS APPLIQUÉES"
              value={String(info.data.appliedMigrations)}
              testId="applied-migrations"
            />
            <Row label="BASE DE DONNÉES" value={info.data.databasePath} />
          </div>
        )}
        {info.error && <p className="text-red-300">{info.error.message}</p>}
      </Card>
    </>
  )
}

const SECTIONS: Partial<Record<SettingsSection, () => ReactNode>> = {
  metadata: () => <MetadataSection />,
  accounts: () => <AccountsSection />,
  cache: () => <CacheSection />,
  launchers: () => <LaunchersSection />,
  folders: () => <FoldersSection />,
  about: () => <AboutSection />
}

// Mockup 08 — settings: section nav on the left, cards on the right.
export function SettingsView({ section }: { section: SettingsSection }) {
  const navigate = useUiStore((s) => s.navigate)
  const render = SECTIONS[section]
  return (
    <section className="flex-1 min-w-0 flex">
      <nav
        aria-label="Sections des réglages"
        className="w-[230px] flex-none flex flex-col gap-[3px] px-4 py-6 border-r border-ink-600"
      >
        <b className="px-3 pb-3 font-display font-bold text-[22px] text-text-hi">Réglages</b>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === section ? 'page' : undefined}
            onClick={() => navigate({ name: 'settings', section: item.id })}
            className={`px-3 py-[9px] rounded-[12px] text-sm text-left cursor-pointer ${
              item.id === section
                ? 'bg-brand-subtle text-white font-semibold'
                : 'text-text-mid hover:bg-ink-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0 flex flex-col gap-5 px-10 py-7 max-w-[860px]">
        {render ? render() : <p className="text-text-lo">Section à venir.</p>}
      </div>
    </section>
  )
}
