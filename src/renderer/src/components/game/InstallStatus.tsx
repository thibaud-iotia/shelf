import type { InstallProgress } from '@shared/models'
import {
  installBytesLabel,
  installHint,
  installPhaseLabel,
  installShortLabel
} from '@shared/install'
import { Button } from '@renderer/components/ui/Button'
import { useCancelInstall } from '@renderer/lib/queries'
import { useNow } from '@renderer/stores/running'
import { Spinner } from './LaunchStatus'

/**
 * Detail page, in place of "Installer": the background install's phase and progress (bar
 * behind the label), the sizes when known, a way to stop it while it can still be stopped.
 */
export function InstallPending({ progress }: { progress: InstallProgress }) {
  const now = useNow(true)
  const cancel = useCancelInstall()
  const label = installPhaseLabel(progress)
  const bytes = installBytesLabel(progress)
  const hint = installHint(progress, now)
  const ratio = progress.progress

  return (
    <>
      <div className="relative flex">
        <Button
          size="lg"
          disabled
          aria-busy
          data-testid="install-status"
          data-phase={progress.phase}
          className="relative overflow-hidden disabled:opacity-100! cursor-progress! min-w-[240px]"
        >
          {ratio !== null && (
            <span
              aria-hidden
              data-testid="install-bar"
              className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-500"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          )}
          {progress.phase !== 'paused' && <Spinner />}
          <span role="status" className="relative">
            {label}
          </span>
          {bytes && (
            <span className="relative font-mono text-xs font-medium text-white/70">{bytes}</span>
          )}
        </Button>
        {hint && (
          <span
            data-testid="install-hint"
            className="absolute right-0 top-full mt-2.5 whitespace-nowrap text-xs font-medium text-amber-300"
          >
            {hint}
          </span>
        )}
      </div>
      {progress.cancellable && (
        <Button
          variant="secondary"
          size="lg"
          aria-label="Annuler l’installation"
          title="Annuler l’installation"
          onClick={() => cancel.mutate(progress.gameId)}
        >
          ✕
        </Button>
      )}
    </>
  )
}

/** Cover badge (grid) while the game installs. */
export function InstallBadge({ progress }: { progress: InstallProgress }) {
  return (
    <span
      data-testid="install-badge"
      role="status"
      title={installPhaseLabel(progress)}
      className="absolute top-2.5 left-2.5 max-w-[calc(100%-20px)] flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(8,8,12,.8)] text-[11px] font-semibold text-brand"
    >
      <span aria-hidden>⤓</span>
      <span className="truncate">{installShortLabel(progress)}</span>
    </span>
  )
}

/** Inline status (list rows). */
export function InstallLabel({ progress }: { progress: InstallProgress }) {
  return (
    <span
      role="status"
      data-testid="install-label"
      className="flex items-center gap-1.5 min-w-0 text-brand"
    >
      <span aria-hidden>⤓</span>
      <span className="truncate">{installPhaseLabel(progress)}</span>
    </span>
  )
}
