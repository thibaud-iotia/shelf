import { stat, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

// Disk facts about a folder that may not exist yet (a folder picked for an install): read on
// its closest existing parent.

async function closestExisting(path: string): Promise<string | null> {
  let current = path
  for (;;) {
    try {
      await stat(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

/** Free space on the disk of `path`; null when unknown. */
export async function diskFree(path: string): Promise<number | null> {
  const existing = await closestExisting(path)
  if (!existing) return null
  try {
    const stats = await statfs(existing)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

/** Identifier of the disk (volume) holding `path`; null when unknown. */
export async function diskOf(path: string): Promise<number | null> {
  const existing = await closestExisting(path)
  if (!existing) return null
  try {
    return (await stat(existing)).dev
  } catch {
    return null
  }
}
