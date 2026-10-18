import { GameFormDialog } from '@renderer/components/game/GameFormDialog'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { TitleBar } from '@renderer/components/layout/TitleBar'
import { Toasts } from '@renderer/components/ui/Toasts'
import { useMainEvents } from '@renderer/lib/queries'
import { useUiStore, type Route } from '@renderer/stores/ui'
import { GameDetailView } from '@renderer/views/GameDetailView'
import { LibraryView } from '@renderer/views/LibraryView'
import { SettingsView } from '@renderer/views/SettingsView'

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'game':
      return <GameDetailView key={route.id} gameId={route.id} />
    case 'settings':
      return <SettingsView />
    case 'library':
    case 'favorites':
    case 'recent':
    case 'source':
      return <LibraryView route={route} />
    default:
      return <LibraryView route={{ name: 'library' }} />
  }
}

export function App() {
  useMainEvents()
  const route = useUiStore((s) => s.route)

  return (
    <div className="flex h-full bg-page">
      <TitleBar />
      <Sidebar />
      <main className="flex flex-1 min-w-0 min-h-0 overflow-auto pt-[var(--title-bar)]">
        <View route={route} />
      </main>
      <GameFormDialog />
      <Toasts />
    </div>
  )
}
