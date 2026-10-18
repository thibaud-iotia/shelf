import { execFile } from 'node:child_process'

export interface RegistryKey {
  path: string
  values: Record<string, string>
}

/**
 * Parses the output of `reg query <key> /s`:
 *   HKEY_LOCAL_MACHINE\SOFTWARE\...\Games\1207658924
 *       gameName    REG_SZ    Hollow Knight
 * Value names are lower-cased.
 */
export function parseRegQuery(output: string): RegistryKey[] {
  const keys: RegistryKey[] = []
  let current: RegistryKey | null = null
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue
    if (/^HKEY_/i.test(line)) {
      current = { path: line.trim(), values: {} }
      keys.push(current)
      continue
    }
    const match =
      /^\s+(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(line) ??
      /^\s+(.+?)\s+(REG_[A-Z_]+)\s*$/.exec(line)
    if (current && match) current.values[match[1]!.trim().toLowerCase()] = (match[3] ?? '').trim()
  }
  return keys
}

/** Reads a registry key recursively (Windows only). Resolves to [] on any failure. */
export function queryRegistry(key: string): Promise<RegistryKey[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, timeout: 10_000 }, (error, stdout) =>
      resolve(error ? [] : parseRegQuery(stdout))
    )
  })
}
