import { TitleBar } from '@renderer/components/layout/TitleBar'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { useUiStore } from '@renderer/stores/ui'
import { LibraryView } from '@renderer/views/LibraryView'
import { SettingsView } from '@renderer/views/SettingsView'

export function App() {
  const view = useUiStore((s) => s.view)
  const gameCount = 0

  return (
    <div className="flex h-full bg-page">
      <TitleBar />
      <Sidebar gameCount={gameCount} />
      <main className="flex flex-1 min-w-0 min-h-0 overflow-auto pt-[var(--title-bar)]">
        {view === 'settings' ? <SettingsView /> : <LibraryView gameCount={gameCount} />}
      </main>
    </div>
  )
}
