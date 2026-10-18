import { AppError } from '@shared/errors'
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc'

/** Typed IPC call; rejects with an AppError carrying the main-process error code. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<C>> {
  const response = await window.shelf.invoke(channel, ...args)
  if (!response.ok) throw AppError.from(response.error)
  return response.data
}
