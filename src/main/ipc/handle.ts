import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AppError, toSerializedError } from '../../shared/errors'
import type { IpcArgs, IpcChannel, IpcResponse, IpcResult } from '../../shared/ipc'

type Handler<C extends IpcChannel> = (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>

// Only our own renderer (dev server or bundled file) may call into main.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  if (!url) return false
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer && url.startsWith(devServer)) return true
  return url.startsWith('file://')
}

/** Registers a typed handler; errors are returned as data, never thrown across IPC. */
export function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResponse<IpcResult<C>>> => {
    if (!isTrustedSender(event)) {
      return { ok: false, error: new AppError('FORBIDDEN', 'Untrusted IPC sender').toJSON() }
    }
    try {
      const data = await handler(...(args as IpcArgs<C>))
      return { ok: true, data }
    } catch (error) {
      console.error(`[ipc] ${channel} failed`, error)
      return { ok: false, error: toSerializedError(error) }
    }
  })
}
