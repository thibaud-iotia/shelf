import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { ScanOptions } from '@shared/ipc'
import type {
  ApiKeyService,
  ApiKeysInput,
  AppSettings,
  CommunityKind,
  ConnectInput,
  Game,
  GameInput,
  GamePatch,
  ImportDecision,
  PurchaseInput,
  SmartRules,
  StoreGameRef
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
  cache: ['cache'] as const,
  store: ['store'] as const,
  wishlist: ['store', 'wishlist'] as const,
  deals: ['store', 'deals'] as const,
  storeSearch: (query: string) => ['store', 'search', query] as const,
  storeGame: (ref: StoreGameRef) =>
    ['store', 'game', ref.steamAppId, ref.cheapsharkId, ref.title] as const,
  /** Game page extras, keyed by what they depend on (an edited appid refetches them). */
  insights: (game: Pick<Game, 'id' | 'steamAppId' | 'igdbId'>, ...part: string[]) =>
    ['insights', game.id, game.steamAppId, game.igdbId, ...part] as const
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

export function useCancelLaunch() {
  return useMutation({
    mutationFn: (id: number) => call('games:cancelLaunch', id),
    onError: (error) => toast.error(error)
  })
}

export function useInstallGame() {
  return useMutation({
    mutationFn: (id: number) => call('games:install', id),
    onSuccess: () => toast.info('Ouverture du launcher pour l’installation…'),
    onError: (error) => toast.error(error)
  })
}

export function useApplyUpdate() {
  return useMutation({
    mutationFn: (id: number) => call('games:applyUpdate', id),
    onSuccess: () => toast.info('Ouverture du launcher pour la mise à jour…'),
    onError: (error) => toast.error(error)
  })
}

/** Re-reads the launchers' files now (they are also re-read every 15 min). */
export function useCheckUpdates() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call('games:checkUpdates'),
    onSuccess: (count) => {
      void invalidateLibrary(client)
      toast.info(
        count === 0
          ? 'Tous vos jeux installés sont à jour.'
          : count === 1
            ? '1 jeu a une mise à jour en attente.'
            : `${count} jeux ont une mise à jour en attente.`
      )
    },
    onError: (error) => toast.error(error)
  })
}

export function useUninstallGame() {
  return useMutation({
    mutationFn: (id: number) => call('games:uninstall', id),
    onSuccess: () =>
      toast.info(
        'Désinstallation lancée : suivez les instructions, Shelf mettra la bibliothèque à jour.'
      ),
    onError: (error) => toast.error(error)
  })
}

export function usePickSaveFolder() {
  return useLibraryMutation((id: number) => call('games:pickSaveFolder', id))
}

export function useExportSaves() {
  return useMutation({
    mutationFn: (id: number) => call('games:exportSaves', id),
    onSuccess: (result) => {
      if (result) toast.success(`Sauvegardes exportées (${result.files} fichiers) : ${result.path}`)
    },
    onError: (error) => toast.error(error)
  })
}

export function usePickRunner() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call('settings:pickRunner'),
    onSuccess: (view) => view && client.setQueryData(queryKeys.settings, view),
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

// Game page extras (main keeps its own 10 min cache)

const INSIGHTS_STALE_MS = 10 * 60_000

/** Undefined while the game itself loads (hooks run before the view's early returns). */
export function useGameInsights(game: Game | undefined) {
  return useQuery({
    queryKey: game ? queryKeys.insights(game, 'overview') : ['insights', 'none'],
    queryFn: () => call('insights:overview', game!.id),
    staleTime: INSIGHTS_STALE_MS,
    enabled: !!game
  })
}

export function useGameNews(game: Game, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.insights(game, 'news'),
    queryFn: () => call('insights:news', game.id),
    staleTime: INSIGHTS_STALE_MS,
    retry: false,
    enabled
  })
}

export function useGameCommunity(game: Game, kind: CommunityKind, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.insights(game, 'community', kind),
    queryFn: () => call('insights:community', game.id, kind),
    staleTime: INSIGHTS_STALE_MS,
    retry: false,
    enabled
  })
}

export function useGameAchievements(game: Game, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.insights(game, 'achievements', String(game.playtimeSec)),
    queryFn: () => call('insights:achievements', game.id),
    staleTime: INSIGHTS_STALE_MS,
    retry: false,
    enabled
  })
}

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

// Store (main keeps its own 10 min cache of prices)

const STORE_STALE_MS = 5 * 60_000
/**
 * Store lists stay in memory long after the page is left: coming back shows them at once
 * (stale-while-revalidate) while fresh prices load in the background.
 */
const STORE_GC_MS = 60 * 60_000

const wishlistQuery = {
  queryKey: queryKeys.wishlist,
  queryFn: () => call('store:wishlist'),
  staleTime: STORE_STALE_MS,
  gcTime: STORE_GC_MS
}

const dealsQuery = {
  queryKey: queryKeys.deals,
  queryFn: () => call('store:deals'),
  staleTime: STORE_STALE_MS,
  gcTime: STORE_GC_MS,
  retry: false
}

/**
 * Loads the store home before it is shown (hover or focus of "Boutique"). The main process
 * has usually warmed its cache at startup, so this costs one IPC round trip. A failure is
 * forgotten (unless the page is open) so the page asks again and shows its own loading state.
 */
export function prefetchStore(client: QueryClient): void {
  prefetchQuietly(client, dealsQuery)
  prefetchQuietly(client, wishlistQuery)
}

function prefetchQuietly<T>(
  client: QueryClient,
  options: { queryKey: readonly unknown[]; queryFn: () => Promise<T>; gcTime: number }
): void {
  const { queryKey } = options
  const state = client.getQueryState(queryKey)
  if (state?.fetchStatus === 'fetching') return
  if (state?.status === 'success' && state.dataUpdatedAt > Date.now() - STORE_STALE_MS) return
  client.fetchQuery({ ...options, staleTime: STORE_STALE_MS, retry: false }).catch(() => {
    const query = client.getQueryCache().find({ queryKey, exact: true })
    if (query && query.getObserversCount() === 0 && query.state.data === undefined) {
      client.removeQueries({ queryKey, exact: true })
    }
  })
}

export function useWishlist() {
  return useQuery(wishlistQuery)
}

export function useSyncWishlist() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => call('store:syncWishlist'),
    onSuccess: (view) => client.setQueryData(queryKeys.wishlist, view),
    onError: (error) => toast.error(error)
  })
}

export function useDeals(enabled: boolean) {
  return useQuery({ ...dealsQuery, enabled })
}

export function useStoreSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: queryKeys.storeSearch(q),
    queryFn: () => call('store:search', q),
    staleTime: STORE_STALE_MS,
    retry: false,
    enabled: q.length > 0
  })
}

/** Steam blocks of a store page (game not in the library), by Steam appid. */
export function useStoreOverview(steamAppId: string | null) {
  return useQuery({
    queryKey: ['store', 'overview', steamAppId] as const,
    queryFn: () => call('store:overview', steamAppId!),
    staleTime: INSIGHTS_STALE_MS,
    retry: false,
    enabled: !!steamAppId
  })
}

export function useStoreNews(steamAppId: string | null) {
  return useQuery({
    queryKey: ['store', 'news', steamAppId] as const,
    queryFn: () => call('store:news', steamAppId!),
    staleTime: INSIGHTS_STALE_MS,
    retry: false,
    enabled: !!steamAppId
  })
}

export function useStoreGame(ref: StoreGameRef | null) {
  return useQuery({
    queryKey: ref ? queryKeys.storeGame(ref) : ['store', 'game', 'none'],
    queryFn: () => call('store:game', ref!),
    staleTime: STORE_STALE_MS,
    retry: false,
    enabled: !!ref
  })
}

function useStoreMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.store }),
    onError: (error) => toast.error(error)
  })
}

export function useAddWish() {
  return useStoreMutation((ref: StoreGameRef) => call('store:addWish', ref))
}

export function useRemoveWish() {
  return useStoreMutation((id: number) => call('store:removeWish', id))
}

const OPENED_IN = {
  steam: 'Page du jeu ouverte dans Steam',
  gog: 'Page du jeu ouverte dans GOG Galaxy',
  browser: 'Page du magasin ouverte dans le navigateur'
} as const

export function useBuy() {
  return useMutation({
    mutationFn: (input: PurchaseInput) => call('store:buy', input),
    onSuccess: ({ opensIn }) =>
      toast.info(
        `${OPENED_IN[opensIn]} : finalisez l’achat, Shelf l’ajoutera à la bibliothèque à votre retour.`
      ),
    onError: (error) => toast.error(error)
  })
}

/** Keeps the renderer in sync with pushes from the main process. Mount once. */
export function useMainEvents() {
  const client = useQueryClient()
  const setRunning = useRunningStore((s) => s.set)
  const setLaunching = useRunningStore((s) => s.setLaunching)

  useEffect(() => {
    void call('games:running').then(setRunning)
    void call('games:launching').then(setLaunching)
    const offRunning = window.shelf.on('games:running', setRunning)
    const offLaunching = window.shelf.on('games:launching', setLaunching)
    const offTimeout = window.shelf.on('games:launchTimeout', ({ title, launcher }) =>
      toast.error(
        `« ${title} » ne s’est pas lancé${launcher === 'steam' ? ' : vérifiez la fenêtre de Steam' : ''}.`
      )
    )
    const offLibrary = window.shelf.on('library:changed', ({ reason }) => {
      void invalidateLibrary(client)
      if (reason === 'uninstall') toast.success('Désinstallation terminée : bibliothèque à jour.')
    })
    const offPurchased = window.shelf.on('store:purchased', ({ title }) => {
      void invalidateLibrary(client)
      void client.invalidateQueries({ queryKey: queryKeys.store })
      toast.success(`Achat détecté : « ${title} » est dans votre bibliothèque.`)
    })
    return () => {
      offRunning()
      offLaunching()
      offTimeout()
      offLibrary()
      offPurchased()
    }
  }, [client, setRunning, setLaunching])
}
