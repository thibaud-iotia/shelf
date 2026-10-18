// Errors crossing the IPC boundary are serialized as { code, message } so the UI
// can show a clear message without parsing Electron's "Error invoking remote method" prefix.

export type AppErrorCode = 'INTERNAL' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'UNKNOWN_CHANNEL'

export interface SerializedAppError {
  code: AppErrorCode
  message: string
}

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }

  static from(serialized: SerializedAppError): AppError {
    return new AppError(serialized.code, serialized.message)
  }

  toJSON(): SerializedAppError {
    return { code: this.code, message: this.message }
  }
}

export function toSerializedError(error: unknown): SerializedAppError {
  if (error instanceof AppError) return error.toJSON()
  if (error instanceof Error) return { code: 'INTERNAL', message: error.message }
  return { code: 'INTERNAL', message: String(error) }
}
