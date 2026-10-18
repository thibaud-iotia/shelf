import { create } from 'zustand'

export type View = 'library' | 'favorites' | 'recent' | 'settings'

interface UiState {
  view: View
  setView: (view: View) => void
}

export const useUiStore = create<UiState>()((set) => ({
  view: 'library',
  setView: (view) => set({ view })
}))
