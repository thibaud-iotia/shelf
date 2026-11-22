import { execFile } from 'node:child_process'

/** Image names of `tasklist /fo csv /nh` output ("GTA5.exe","1234","Console",…), lower-cased. */
export function parseTasklist(output: string): Set<string> {
  const names = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim())
    if (m) names.add(m[1]!.toLowerCase())
  }
  return names
}

/**
 * Whether a process with one of these file names runs (Windows; always false elsewhere,
 * callers then rely on what the launcher logs).
 */
export function anyProcessRunning(images: string[]): Promise<boolean> {
  if (process.platform !== 'win32' || images.length === 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/fo', 'csv', '/nh'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        // tasklist unavailable: do not end a session on a failed check.
        if (error) return resolve(true)
        const running = parseTasklist(stdout)
        resolve(images.some((image) => running.has(image.toLowerCase())))
      }
    )
  })
}
