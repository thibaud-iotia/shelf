import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNEL, isIpcChannel, isIpcEvent, type ShelfApi } from '../shared/ipc'

const api: ShelfApi = {
  invoke(channel, ...args) {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` }
      })
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on(event, listener) {
    if (!isIpcEvent(event)) throw new Error(`Unknown event: ${String(event)}`)
    const wrapped = (_: IpcRendererEvent, name: unknown, payload: unknown) => {
      if (name === event) listener(payload as Parameters<typeof listener>[0])
    }
    ipcRenderer.on(EVENT_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, wrapped)
  }
}

contextBridge.exposeInMainWorld('shelf', api)
