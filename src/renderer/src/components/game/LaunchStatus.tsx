import type { LaunchProgress } from '@shared/models'
import {
  formatElapsed,
  launchPhaseLabel,
  launchPhaseShortLabel,
  launchStallHint
} from '@shared/launch'
import { Button } from '@renderer/components/ui/Button'
import { useCancelLaunch } from '@renderer/lib/queries'
import { useNow } from '@renderer/stores/running'

/** Small ring spinning while a launch is in progress. */
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <i
      aria-hidden
      className={`inline-block flex-none rounded-full border-2 border-current border-r-transparent animate-spin ${className}`}
    />
  )
}

/**
 * Detail page, in place of "▶ Jouer": what the launch is waiting for, the time elapsed, a way to
 * stop waiting and, when a phase lasts, a hint (a launcher dialog may be waiting for the user).
 */
export function LaunchPending({ progress }: { progress: LaunchProgress }) {
  const now = useNow(true)
  const cancel = useCancelLaunch()
  const label = launchPhaseLabel(progress.phase, progress.launcher)
  const hint = launchStallHint(progress, now)

  return (
    <>
      <div className="relative flex">
        <Button
          size="lg"
          disabled
          aria-busy
          data-testid="launch-status"
          data-phase={progress.phase}
          className="disabled:opacity-100! cursor-progress! min-w-[220px]"
        >
          <Spinner />
          <span role="status">{label}</span>
          <span className="font-mono text-xs font-medium text-white/70">
            {formatElapsed(now - progress.startedAt)}
          </span>
        </Button>
        {hint && (
          <span
            data-testid="launch-hint"
            className="absolute right-0 top-full mt-2.5 whitespace-nowrap text-xs font-medium text-amber-300"
          >
            {hint}
          </span>
        )}
      </div>
      <Button
        variant="secondary"
        size="lg"
        aria-label="Ne plus attendre le lancement"
        title="Ne plus attendre (le launcher continue de son côté)"
        onClick={() => cancel.mutate(progress.gameId)}
      >
        ✕
      </Button>
    </>
  )
}

/** Cover badge (grid) while a launch is in progress. */
export function LaunchBadge({ progress }: { progress: LaunchProgress }) {
  return (
    <span
      data-testid="launch-badge"
      role="status"
      title={launchPhaseLabel(progress.phase, progress.launcher)}
      className="absolute top-2.5 left-2.5 max-w-[calc(100%-20px)] flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[rgba(8,8,12,.8)] text-[11px] font-semibold text-brand"
    >
      <Spinner className="w-2.5 h-2.5 border-[1.5px]" />
      <span className="truncate">{launchPhaseShortLabel(progress.phase, progress.launcher)}</span>
    </span>
  )
}

/** Inline status (list rows, sidebar): spinner and phase. */
export function LaunchLabel({ progress }: { progress: LaunchProgress }) {
  return (
    <span
      role="status"
      data-testid="launch-label"
      className="flex items-center gap-1.5 min-w-0 text-brand"
    >
      <Spinner className="w-3 h-3" />
      <span className="truncate">{launchPhaseLabel(progress.phase, progress.launcher)}</span>
    </span>
  )
}
