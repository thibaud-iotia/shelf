import { useCallback, type MouseEvent } from 'react'
import type { Game } from '@shared/models'
import type { ScanOptions } from '@shared/ipc'
import { useImportStore } from '@renderer/stores/import'
import { toast } from '@renderer/stores/toasts'
import { useUiStore } from '@renderer/stores/ui'
import { call } from './ipc'
import { useLaunchGame, useScan } from './queries'

/** Launch with user feedback: tracked processes show the running badge, URIs a toast. */
export function usePlay() {
  const launch = useLaunchGame()
  return useCallback(
    async (game: Game) => {
      try {
        const result = await launch.mutateAsync([game.id])
        if (!result.tracked) toast.info(`${game.title} : lancement via le launcher…`)
      } catch {
        // Error toast already shown by the mutation.
      }
    },
    [launch]
  )
}

/** Runs a detection and opens the review screen (mockup 04). */
export function useStartScan() {
  const scan = useScan()
  const setResult = useImportStore((s) => s.setResult)
  const navigate = useUiStore((s) => s.navigate)
  const run = useCallback(
    async (options: ScanOptions = {}) => {
      try {
        const result = await scan.mutateAsync(options)
        setResult(result)
        navigate({ name: 'import' })
      } catch {
        // Error toast already shown by the mutation.
      }
    },
    [scan, setResult, navigate]
  )
  return { run, isPending: scan.isPending }
}

/** Asks for a folder and scans only that folder. */
export function useScanFolder() {
  const { run, isPending } = useStartScan()
  const pick = useCallback(async () => {
    const folder = await call('import:pickFolder').catch((e: unknown) => {
      toast.error(e)
      return null
    })
    if (folder) await run({ includeLaunchers: false, folders: [folder] })
  }, [run])
  return { pick, isPending }
}

/** Opens the context menu of mockup 07 at the pointer. */
export function useGameContextMenu() {
  const open = useUiStore((s) => s.openContextMenu)
  const select = useUiStore((s) => s.select)
  return (event: MouseEvent, game: Game) => {
    select(game.id)
    open({ gameId: game.id, x: event.clientX, y: event.clientY })
  }
}
