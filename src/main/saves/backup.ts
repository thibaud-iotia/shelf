import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { zipSync, type Zippable } from 'fflate'
import { AppError } from '../../shared/errors'

export interface BackupResult {
  path: string
  files: number
  bytes: number
}

const MAX_BYTES = 2 * 1024 ** 3

function collect(
  root: string,
  dir: string,
  into: Zippable,
  stats: { files: number; bytes: number }
) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collect(root, path, into, stats)
    } else if (entry.isFile()) {
      stats.bytes += statSync(path).size
      if (stats.bytes > MAX_BYTES) {
        throw new AppError('VALIDATION', 'Dossier de sauvegardes trop volumineux (plus de 2 Go).')
      }
      // Zip entries always use "/" separators.
      into[relative(root, path).split(sep).join('/')] = [
        readFileSync(path),
        { mtime: statSync(path).mtime }
      ]
      stats.files++
    }
  }
}

/** Zips a save folder (recursively) into `target`. */
export function exportSaves(folder: string, target: string): BackupResult {
  let isDir = false
  try {
    isDir = statSync(folder).isDirectory()
  } catch {
    // handled below
  }
  if (!isDir) throw new AppError('NOT_FOUND', `Dossier de sauvegardes introuvable : ${folder}`)
  const entries: Zippable = {}
  const stats = { files: 0, bytes: 0 }
  collect(folder, folder, entries, stats)
  if (stats.files === 0) throw new AppError('VALIDATION', 'Le dossier de sauvegardes est vide.')
  writeFileSync(target, zipSync(entries, { level: 6 }))
  return { path: target, ...stats }
}

/** "Hollow Knight" → "Hollow Knight-saves-2026-10-18.zip" (file-system safe). */
export function backupFileName(title: string, date = new Date()): string {
  const forbidden = '<>:"/\\|?*'
  const safe =
    [...title]
      .map((c) => (c.charCodeAt(0) < 32 || forbidden.includes(c) ? ' ' : c))
      .join('')
      .replace(/\s+/g, ' ')
      .trim() || 'jeu'
  return `${safe}-saves-${date.toISOString().slice(0, 10)}.zip`
}
