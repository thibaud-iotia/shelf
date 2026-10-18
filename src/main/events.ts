import { BrowserWindow } from 'electron'
import { EVENT_CHANNEL, type IpcEvent, type IpcEvents } from '../shared/ipc'

/** Pushes an event to every renderer window. */
export function broadcast<E extends IpcEvent>(event: E, payload: IpcEvents[E]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, event, payload)
  }
}
