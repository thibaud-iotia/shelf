import { basename, extname } from 'node:path'

/** "hollow_knight" → "Hollow Knight", "DeadCells" → "Dead Cells", "doom-x64" → "Doom". */
export function prettifyName(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\b(x64|x86|x86 64|win64|win32|64|32|bit|shipping)\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const title = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return title || name
}

/** "D:\Games\hollow_knight\hollow_knight.exe" → "Hollow Knight". */
export function titleFromExecutable(path: string): string {
  return prettifyName(basename(path, extname(path)))
}

/**
 * Comparison key for de-duplication across sources:
 * "DOOM (2016)™" and "Doom 2016" → "doom2016"; "The Witcher 3" and "Witcher 3" → "witcher3".
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/\b(goty|game of the year|definitive|remastered|complete|edition)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
}
