import { GameFormDialog } from '@renderer/components/game/GameFormDialog'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { TitleBar } from '@renderer/components/layout/TitleBar'
import { Toasts } from '@renderer/components/ui/Toasts'
import { useEffect } from 'react'
import { useGames, useMainEvents, useSettings } from '@renderer/lib/queries'
import { useUiStore, type Route } from '@renderer/stores/ui'
import { GameDetailView } from '@renderer/views/GameDetailView'
import { ImportView } from '@renderer/views/ImportView'
import { LibraryView } from '@renderer/views/LibraryView'
import { OnboardingView } from '@renderer/views/OnboardingView'
import { SettingsView } from '@renderer/views/SettingsView'

function View({ route }: { route: Route }) {
  switch (route.name) {
    case 'game':
      return <GameDetailView key={route.id} gameId={route.id} />
    case 'settings':
      return <SettingsView section={route.section} />
    case 'import':
      return <ImportView />
    case 'onboarding':
      return <OnboardingView />
    case 'library':
    case 'favorites':
    case 'recent':
    case 'source':
      return <LibraryView route={route} />
    default:
      return <LibraryView route={{ name: 'library' }} />
  }
}

/** First launch with an empty library: start with the onboarding wizard. */
function useFirstRun() {
  const settings = useSettings()
  const games = useGames()
  const navigate = useUiStore((s) => s.navigate)
  const firstRun = settings.data?.onboardingDone === false && games.data?.length === 0
  useEffect(() => {
    if (firstRun) navigate({ name: 'onboarding' })
  }, [firstRun, navigate])
}

export function App() {
  useMainEvents()
  useFirstRun()
  const route = useUiStore((s) => s.route)

  return (
    <div className="flex h-full bg-page">
      <TitleBar />
      {route.name !== 'onboarding' && <Sidebar />}
      <main className="flex flex-1 min-w-0 min-h-0 overflow-auto pt-[var(--title-bar)]">
        <View route={route} />
      </main>
      <GameFormDialog />
      <Toasts />
    </div>
  )
}
