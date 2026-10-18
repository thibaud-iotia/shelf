import { contextBridge, ipcRenderer } from 'electron'
import { isIpcChannel, type ShelfApi } from '../shared/ipc'

const api: ShelfApi = {
  invoke(channel, ...args) {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: `Unknown channel: ${String(channel)}` }
      })
    }
    return ipcRenderer.invoke(channel, ...args)
  }
}

contextBridge.exposeInMainWorld('shelf', api)
