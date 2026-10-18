import { useQuery } from '@tanstack/react-query'
import { call } from './ipc'

export const queryKeys = {
  ping: ['app', 'ping'] as const,
  appInfo: ['app', 'info'] as const
}

export function usePing() {
  return useQuery({ queryKey: queryKeys.ping, queryFn: () => call('app:ping') })
}

export function useAppInfo() {
  return useQuery({ queryKey: queryKeys.appInfo, queryFn: () => call('app:info') })
}
