import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: Toast['kind'], message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = {
  info: (message: string) => useToasts.getState().push('info', message),
  success: (message: string) => useToasts.getState().push('success', message),
  error: (error: unknown) =>
    useToasts.getState().push('error', error instanceof Error ? error.message : String(error))
}
