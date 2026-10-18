import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './app.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // Data comes from the local main process: no focus refetch, one retry.
    queries: { refetchOnWindowFocus: false, retry: 1 }
  }
})

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
