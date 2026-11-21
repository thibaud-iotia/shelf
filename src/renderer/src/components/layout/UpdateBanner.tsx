import { Button } from '@renderer/components/ui/Button'
import {
  useDismissUpdateNotice,
  useInstallUpdate,
  useOpenUpdateDownload,
  useUpdaterState
} from '@renderer/lib/queries'
import { useRunningStore } from '@renderer/stores/running'

const BANNER = 'flex flex-col gap-2 mb-2 p-3 rounded-[12px] bg-ink-800 border'

/**
 * Shelf restarted on an update but still runs the old version: the installer did not run
 * (often an antivirus quarantining an unsigned installer). Offers the manual download.
 */
function BlockedInstall({ version }: { version: string }) {
  const openDownload = useOpenUpdateDownload()
  const dismiss = useDismissUpdateNotice()
  return (
    <div data-testid="update-banner" data-phase="blocked" className={`${BANNER} border-red-300/40`}>
      <span className="text-sm font-semibold text-text-hi">
        Shelf {version} ne s’est pas installée
      </span>
      <span className="text-xs text-text-lo">
        Un antivirus a peut-être bloqué l’installeur. Installez-le à la main, par-dessus : vos jeux
        et réglages sont conservés.
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={openDownload.isPending}
          onClick={() => openDownload.mutate()}
        >
          Télécharger
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()}>
          Ignorer
        </Button>
      </div>
    </div>
  )
}

/**
 * New version of Shelf, at the bottom of the sidebar: download progress, then "Redémarrer"
 * (auto mode) or "Télécharger" (manual mode: macOS, .deb); or the notice of a blocked
 * install. Nothing otherwise.
 */
export function UpdateBanner() {
  const { data: state } = useUpdaterState()
  const install = useInstallUpdate()
  const openDownload = useOpenUpdateDownload()
  // Restarting during a game would cut the session Shelf is measuring.
  const playing = useRunningStore((s) => s.ids.length > 0)
  if (state?.lastInstall?.outcome === 'failed') {
    return <BlockedInstall version={state.lastInstall.version} />
  }
  if (!state || !state.version) return null
  if (!['available', 'downloading', 'ready'].includes(state.phase)) return null

  return (
    <div
      data-testid="update-banner"
      data-phase={state.phase}
      className={`${BANNER} border-ink-600`}
    >
      <span className="text-sm font-semibold text-text-hi">Shelf {state.version}</span>

      {state.phase === 'downloading' && (
        <>
          <span role="status" className="text-xs text-text-lo">
            Téléchargement… {state.percent ?? 0} %
          </span>
          <span aria-hidden className="h-1 rounded-full bg-ink-600 overflow-hidden">
            <span
              data-testid="update-bar"
              className="block h-full bg-grad-brand transition-[width] duration-500"
              style={{ width: `${state.percent ?? 0}%` }}
            />
          </span>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <span className="text-xs text-text-lo">
            {playing
              ? 'Prête : installée à la fin de votre partie, ou en quittant Shelf.'
              : 'Prête : vos jeux et réglages sont conservés.'}
          </span>
          <Button
            size="sm"
            disabled={playing || install.isPending}
            onClick={() => install.mutate()}
          >
            Redémarrer
          </Button>
        </>
      )}

      {state.phase === 'available' && (
        <>
          <span className="text-xs text-text-lo">
            Nouvelle version : installez-la par-dessus, sans désinstaller.
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={openDownload.isPending}
            onClick={() => openDownload.mutate()}
          >
            Télécharger
          </Button>
        </>
      )}
    </div>
  )
}
