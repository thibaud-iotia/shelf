import { readdir, readFile, stat } from 'node:fs/promises'

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) if (await exists(path)) return path
  return null
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  const text = await readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as T
  } catch {
    return null
  }
}

export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}
