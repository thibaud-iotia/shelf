import { create } from 'zustand'
import type { GameSourceId } from '@shared/domain'
import type { StoreGameRef } from '@shared/models'

export type SettingsSection =
  | 'metadata'
  | 'accounts'
  | 'launchers'
  | 'folders'
  | 'appearance'
  | 'shortcuts'
  | 'system'
  | 'cache'
  | 'about'

export type Route =
  | { name: 'library' }
  | { name: 'favorites' }
  | { name: 'recent' }
  | { name: 'source'; source: GameSourceId }
  | { name: 'collection'; id: number }
  | { name: 'game'; id: number }
  | { name: 'import' }
  | { name: 'onboarding' }
  | { name: 'settings'; section: SettingsSection }
  | { name: 'store' }
  /** Store page of a game to buy (not in the library). */
  | { name: 'storeGame'; ref: StoreGameRef }

/** Routes that show a grid of games (and share the filter bar). */
export type ListRoute = Extract<Route, { name: 'library' | 'favorites' | 'recent' | 'source' }>

export type GameForm = { mode: 'create' } | { mode: 'edit'; gameId: number }

/** Store sections; kept while visiting a game's store page and coming back. */
export type StoreTab = 'home' | 'wishlist' | 'deals'

export type InstallFilter = 'all' | 'installed' | 'not_installed' | 'update'
export type Layout = 'grid' | 'list'

export interface ContextMenuState {
  gameId: number
  x: number
  y: number
}

interface UiState {
  route: Route
  history: Route[]
  navigate: (route: Route) => void
  back: () => void

  filterText: string
  setFilterText: (text: string) => void
  installFilter: InstallFilter
  setInstallFilter: (filter: InstallFilter) => void
  favoritesOnly: boolean
  toggleFavoritesOnly: () => void
  tagFilter: string | null
  setTagFilter: (tag: string | null) => void
  layout: Layout
  setLayout: (layout: Layout) => void

  storeTab: StoreTab
  setStoreTab: (tab: StoreTab) => void
  storeQuery: string
  setStoreQuery: (query: string) => void

  selectedGameId: number | null
  select: (id: number | null) => void

  gameForm: GameForm | null
  openGameForm: (form: GameForm) => void
  closeGameForm: () => void

  /** Game whose "Supprimer…" dialog (uninstall / remove from the library) is open. */
  removingGameId: number | null
  openRemoveGame: (id: number) => void
  closeRemoveGame: () => void

  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void

  contextMenu: ContextMenuState | null
  openContextMenu: (menu: ContextMenuState) => void
  closeContextMenu: () => void
}

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

export const useUiStore = create<UiState>()((set) => ({
  route: { name: 'library' },
  history: [],
  navigate: (route) =>
    set((s) =>
      sameRoute(s.route, route)
        ? {}
        : { route, history: [...s.history.slice(-30), s.route], contextMenu: null }
    ),
  back: () =>
    set((s) => {
      const previous = s.history.at(-1)
      return previous
        ? { route: previous, history: s.history.slice(0, -1) }
        : { route: { name: 'library' } }
    }),

  filterText: '',
  setFilterText: (filterText) => set({ filterText }),
  installFilter: 'all',
  setInstallFilter: (installFilter) => set({ installFilter }),
  favoritesOnly: false,
  toggleFavoritesOnly: () => set((s) => ({ favoritesOnly: !s.favoritesOnly })),
  tagFilter: null,
  setTagFilter: (tagFilter) => set({ tagFilter }),
  layout: 'grid',
  setLayout: (layout) => set({ layout }),

  storeTab: 'home',
  setStoreTab: (storeTab) => set({ storeTab }),
  storeQuery: '',
  setStoreQuery: (storeQuery) => set({ storeQuery }),

  selectedGameId: null,
  select: (selectedGameId) => set({ selectedGameId }),

  gameForm: null,
  openGameForm: (gameForm) => set({ gameForm, contextMenu: null }),
  closeGameForm: () => set({ gameForm: null }),

  removingGameId: null,
  openRemoveGame: (removingGameId) => set({ removingGameId, contextMenu: null }),
  closeRemoveGame: () => set({ removingGameId: null }),

  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen, contextMenu: null }),

  contextMenu: null,
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null })
}))
