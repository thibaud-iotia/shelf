import { readFileSync, rmSync, writeFileSync } from 'node:fs'

/** The update Shelf restarted on: checked at the next startup (installed, or blocked). */
export interface InstallAttempt {
  version: string
  /** Installers of that release, to offer a manual download if the install was blocked. */
  files: string[]
  /** ms since epoch. */
  at: number
}

export interface AttemptStore {
  read(): InstallAttempt | null
  /** Synchronous: written right before Shelf quits for the installer. */
  write(attempt: InstallAttempt | null): void
}

function isAttempt(value: unknown): value is InstallAttempt {
  if (!value || typeof value !== 'object') return false
  const { version, files, at } = value as Record<string, unknown>
  return (
    typeof version === 'string' &&
    Array.isArray(files) &&
    files.every((f) => typeof f === 'string') &&
    typeof at === 'number'
  )
}

/** A small JSON file in userData (the installer never touches userData). */
export function fileAttemptStore(path: string): AttemptStore {
  return {
    read() {
      try {
        const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
        return isAttempt(value) ? value : null
      } catch {
        return null
      }
    },
    write(attempt) {
      try {
        if (attempt) writeFileSync(path, JSON.stringify(attempt))
        else rmSync(path, { force: true })
      } catch (error) {
        // Losing this note only loses the "install blocked" notice.
        console.warn('[updater] cannot write the install attempt', error)
      }
    }
  }
}
