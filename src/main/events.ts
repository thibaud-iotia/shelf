import { BrowserWindow } from 'electron'
import { EVENT_CHANNEL, type IpcEvent, type IpcEvents } from '../shared/ipc'

type Listener = (event: IpcEvent) => void
const listeners = new Set<Listener>()

/** Main-process subscribers (tray menu…) notified of every broadcast. */
export function onBroadcast(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Pushes an event to every renderer window. */
export function broadcast<E extends IpcEvent>(event: E, payload: IpcEvents[E]): void {
  for (const listener of listeners) listener(event)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event, payload)
  }
}
