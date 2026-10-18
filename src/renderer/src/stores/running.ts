import { create } from 'zustand'

/** Ids of the games whose process is running, pushed by the main process. */
export const useRunningStore = create<{ ids: number[]; set: (ids: number[]) => void }>()((set) => ({
  ids: [],
  set: (ids) => set({ ids })
}))

export function useIsRunning(gameId: number): boolean {
  return useRunningStore((s) => s.ids.includes(gameId))
}
