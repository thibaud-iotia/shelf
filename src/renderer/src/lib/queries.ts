import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { GameInput, GamePatch } from '@shared/models'
import { useRunningStore } from '@renderer/stores/running'
import { toast } from '@renderer/stores/toasts'
import { call } from './ipc'

export const queryKeys = {
  ping: ['app', 'ping'] as const,
  appInfo: ['app', 'info'] as const,
  games: ['games'] as const,
  game: (id: number) => ['games', id] as const
}

export function usePing() {
  return useQuery({ queryKey: queryKeys.ping, queryFn: () => call('app:ping') })
}

export function useAppInfo() {
  return useQuery({ queryKey: queryKeys.appInfo, queryFn: () => call('app:info') })
}

// Games

export function useGames() {
  return useQuery({ queryKey: queryKeys.games, queryFn: () => call('games:list') })
}

export function useGameDetail(id: number) {
  return useQuery({ queryKey: queryKeys.game(id), queryFn: () => call('games:get', id) })
}

/** Everything derived from the library (games, tags, collections…) is refreshed together. */
export function invalidateLibrary(client: QueryClient) {
  return client.invalidateQueries({ queryKey: queryKeys.games })
}

function useLibraryMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: () => invalidateLibrary(client),
    onError: (error) => toast.error(error)
  })
}

export function useCreateGame() {
  return useLibraryMutation((input: GameInput) => call('games:create', input))
}

export function useUpdateGame() {
  return useLibraryMutation((id: number, patch: GamePatch) => call('games:update', id, patch))
}

export function useDeleteGame() {
  return useLibraryMutation((id: number) => call('games:delete', id))
}

export function useLaunchGame() {
  return useLibraryMutation((id: number) => call('games:launch', id))
}

export function useOpenFolder() {
  return useMutation({
    mutationFn: (id: number) => call('games:openFolder', id),
    onError: (error) => toast.error(error)
  })
}

/** Keeps the renderer in sync with pushes from the main process. Mount once. */
export function useMainEvents() {
  const client = useQueryClient()
  const setRunning = useRunningStore((s) => s.set)

  useEffect(() => {
    void call('games:running').then(setRunning)
    const offRunning = window.shelf.on('games:running', setRunning)
    const offLibrary = window.shelf.on('library:changed', () => void invalidateLibrary(client))
    return () => {
      offRunning()
      offLibrary()
    }
  }, [client, setRunning])
}
