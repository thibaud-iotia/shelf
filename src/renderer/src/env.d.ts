/// <reference types="vite/client" />

import type { ShelfApi } from '@shared/ipc'

declare global {
  interface Window {
    shelf: ShelfApi
  }
}
