import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { InstallProgress, LaunchProgress } from '@shared/models'

interface RunningState {
  /** Ids of the games whose process is running, pushed by the main process. */
  ids: number[]
  /** Launches in progress (clicked, the game not running yet), pushed by the main process. */
  launching: LaunchProgress[]
  /** Background installs in progress, pushed by the main process. */
  installing: InstallProgress[]
  set: (ids: number[]) => void
  setLaunching: (launching: LaunchProgress[]) => void
  setInstalling: (installing: InstallProgress[]) => void
}

export const useRunningStore = create<RunningState>()((set) => ({
  ids: [],
  launching: [],
  installing: [],
  set: (ids) => set({ ids }),
  setLaunching: (launching) => set({ launching }),
  setInstalling: (installing) => set({ installing })
}))

export function useIsRunning(gameId: number): boolean {
  return useRunningStore((s) => s.ids.includes(gameId))
}

/** Where the launch of a game stands; null when none is in progress. */
export function useLaunchProgress(gameId: number): LaunchProgress | null {
  return useRunningStore((s) => s.launching.find((l) => l.gameId === gameId) ?? null)
}

/** Where the background install of a game stands; null when none is in progress. */
export function useInstallProgress(gameId: number): InstallProgress | null {
  return useRunningStore((s) => s.installing.find((i) => i.gameId === gameId) ?? null)
}

/** Current time, refreshed every second while `active` (elapsed time of a launch). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
