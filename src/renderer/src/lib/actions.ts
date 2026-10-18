import { useCallback } from 'react'
import type { Game } from '@shared/models'
import { useLaunchGame } from './queries'
import { toast } from '@renderer/stores/toasts'

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
