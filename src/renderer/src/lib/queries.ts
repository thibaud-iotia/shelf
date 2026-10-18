import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ScanOptions } from '@shared/ipc'
import type {
  ApiKeyService,
  ApiKeysInput,
  AppSettings,
  ConnectInput,
  GameInput,
  GamePatch,
  ImportDecision,
  SmartRules
} from '@shared/models'
import { useRunningStore } from '@renderer/stores/running'
import { toast } from '@renderer/stores/toasts'
import { call } from './ipc'

export const queryKeys = {
  ping: ['app', 'ping'] as const,
  appInfo: ['app', 'info'] as const,
  games: ['games'] as const,
  game: (id: number) => ['games', id] as const,
  settings: ['settings'] as const,
  launchers: ['launchers'] as const,
  accounts: ['games', 'accounts'] as const,
  tags: ['games', 'tags'] as const,
  collections: ['games', 'collections'] as const,
  metadataSearch: (title: string) => ['metadata', 'search', title] as const,
  cache: ['cache'] as const
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

export function useInstallGame() {
  return useMutation({
    mutationFn: (id: number) => call('games:install', id),
    onSuccess: () => toast.info('Ouverture du launcher pour l’installation…'),
    onError: (error) => toast.error(error)
  })
}

export function useOpenFolder() {
  return useMutation({
    mutationFn: (id: number) => call('games:openFolder', id),
    onError: (error) => toast.error(error)
  })
}

// Tags & collections (keys under 'games' so a library refresh updates them too)

export function useTags() {
  return useQuery({ queryKey: queryKeys.tags, queryFn: () => call('tags:list') })
}

export function useSetTags() {
  return useLibraryMutation((gameId: number, names: string[]) =>
    call('games:setTags', gameId, names)
  )
}

export function useCollections() {
  return useQuery({ queryKey: queryKeys.collections, queryFn: () => call('collections:list') })
}

export function useCreateCollection() {
  return useLibraryMutation((name: string, rules?: SmartRules | null) =>
    call('collections:create', name, rules ?? null)
  )
}

export function useUpdateCollection() {
  return useLibraryMutation((id: number, patch: { name?: string; rules?: SmartRules | null }) =>
    call('collections:update', id, patch)
  )
}

export function useDeleteCollection() {
  return useLibraryMutation((id: number) => call('collections:delete', id))
}

export function useAddToCollection() {
  return useLibraryMutation((id: number, gameIds: number[]) =>
    call('collections:addGames', id, gameIds)
  )
}

export function useRemoveFromCollection() {
  return useLibraryMutation((id: number, gameId: number) =>
    call('collections:removeGame', id, gameId)
  )
}

// Settings

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: () => call('settings:get') })
}

export function useUpdateSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => call('settings:update', patch),
    onSuccess: (view) => {
      client.setQueryData(queryKeys.settings, view)
      void client.invalidateQueries({ queryKey: queryKeys.launchers })
    },
    onError: (error) => toast.error(error)
  })
}

// Detection & import

export function useLaunchers() {
  return useQuery({ queryKey: queryKeys.launchers, queryFn: () => call('launchers:list') })
}

export function useScan() {
  return useMutation({
    mutationFn: (options: ScanOptions = {}) => call('import:scan', options),
    onError: (error) => toast.error(error)
  })
}

export function useApplyImport() {
  return useLibraryMutation((decisions: ImportDecision[]) => call('import:apply', decisions))
}

// Accounts (owned libraries)

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: () => call('accounts:list') })
}

export function useConnectAccount() {
  return useLibraryMutation((input: ConnectInput) => call('accounts:connect', input))
}

export function useDisconnectAccount() {
  return useLibraryMutation((id: string) => call('accounts:disconnect', id))
}

export function useSyncAccounts() {
  return useLibraryMutation((id?: string) => call('accounts:sync', id))
}

// Metadata & artwork

export function useMetadataSearch(title: string, enabled = true) {
  const query = title.trim()
  return useQuery({
    queryKey: queryKeys.metadataSearch(query),
    queryFn: () => call('metadata:search', query),
    enabled: enabled && query.length > 0,
    staleTime: 10 * 60_000
  })
}

export function useApplyMetadata() {
  return useLibraryMutation((gameId: number, igdbId: number | null) =>
    call('metadata:apply', gameId, igdbId)
  )
}

export function useRefreshArtwork() {
  return useLibraryMutation((gameId: number) => call('metadata:refreshArtwork', gameId))
}

export function usePickCover() {
  return useLibraryMutation((gameId: number) => call('games:pickCover', gameId))
}

export function useSetKeys() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ApiKeysInput) => call('keys:set', input),
    onSuccess: (view) => client.setQueryData(queryKeys.settings, view),
    onError: (error) => toast.error(error)
  })
}

export function useClearKeys() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (service: ApiKeyService) => call('keys:clear', service),
    onSuccess: (view) => client.setQueryData(queryKeys.settings, view),
    onError: (error) => toast.error(error)
  })
}

export function useTestKey() {
  return useMutation({ mutationFn: (service: ApiKeyService) => call('keys:test', service) })
}

export function useCacheInfo() {
  return useQuery({ queryKey: queryKeys.cache, queryFn: () => call('cache:info') })
}

export function useClearCache() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call('cache:clear'),
    onSuccess: (info) => {
      client.setQueryData(queryKeys.cache, info)
      void invalidateLibrary(client)
    },
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
