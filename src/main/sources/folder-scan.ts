import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { normalizeTitle, prettifyName } from '../games/titles'

// Scan of user-chosen folders for standalone games: one game per sub-folder, the best
// executable inside it, and the obvious non-game executables flagged as excluded.

const MAX_DEPTH = 4

const EXECUTABLE_EXTENSIONS: Record<string, string[]> = {
  win32: ['.exe'],
  linux: ['.exe', '.x86_64', '.x86', '.sh', '.appimage'],
  darwin: ['.app']
}

/** Folders that never hold the game's main executable. */
const SKIPPED_DIRS =
  /^(_commonredist|__redist|redist|redistributables?|directx|dotnet|vcredist|_?support|prereqs?|installers?|node_modules|\.git|__macosx|engine|crashreport(er)?)$/i

const EXCLUSIONS: [RegExp, string][] = [
  [/^unins\d*$|uninstall/i, 'uninstall'],
  [/^(setup|install|installer)([-_ .]|$)|[-_ ](setup|installer)$/i, 'installateur'],
  [/vc_?redist|dxsetup|directx|dotnet|redist|physx|oalinst|ue4prereq|prereq/i, 'redistribuable'],
  [/crash|bugreport|errorreport/i, 'crash reporter'],
  [
    /^(config|configtool|settings|updater?|helper|benchmark|cefsharp|7z|notification_helper|qtwebengineprocess|zfgamebrowser|dowser)/i,
    'outil'
  ]
]

const SECONDARY_LAUNCHER = /launcher|^start$|^play$/i

export interface FolderFinding {
  /** Absolute path of the executable (or .app bundle). */
  path: string
  /** Game folder (direct child of the scanned folder). */
  folder: string
  title: string
  excludedReason: string | null
}

export function exclusionReason(fileName: string, extra: string[] = []): string | null {
  const name = basename(fileName, extname(fileName))
  for (const [pattern, reason] of EXCLUSIONS) if (pattern.test(name)) return reason
  const lower = name.toLowerCase()
  if (extra.some((fragment) => fragment && lower.includes(fragment.toLowerCase()))) {
    return 'exclusion personnalisée'
  }
  return null
}

interface Executable {
  path: string
  depth: number
  size: number
}

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function collectExecutables(
  dir: string,
  extensions: string[],
  depth = 0,
  out: Executable[] = []
): Promise<Executable[]> {
  if (depth > MAX_DEPTH) return out
  for (const entry of await entries(dir)) {
    const path = join(dir, entry.name)
    const ext = extname(entry.name).toLowerCase()
    if (entry.isDirectory()) {
      if (ext === '.app' && extensions.includes('.app')) {
        out.push({ path, depth, size: 0 })
      } else if (!SKIPPED_DIRS.test(entry.name)) {
        await collectExecutables(path, extensions, depth + 1, out)
      }
    } else if (entry.isFile() && extensions.includes(ext)) {
      const size = await stat(path).then(
        (s) => s.size,
        () => 0
      )
      out.push({ path, depth, size })
    }
  }
  return out
}

/** Higher is more likely the game itself. */
function score(exe: Executable, folderKey: string): number {
  const name = basename(exe.path, extname(exe.path))
  const key = normalizeTitle(name)
  let points = 0
  if (key && folderKey && (key.includes(folderKey) || folderKey.includes(key))) points += 100
  if (SECONDARY_LAUNCHER.test(name)) points -= 40
  if (/-win64-shipping$/i.test(name)) points += 30
  points -= exe.depth * 10
  points += Math.min(20, exe.size / (5 * 1024 * 1024))
  return points
}

/** Picks the main executable of one game folder and lists the excluded ones. */
export function pickExecutables(
  folder: string,
  executables: Executable[],
  extraExclusions: string[] = []
): FolderFinding[] {
  const title = prettifyName(basename(folder))
  const folderKey = normalizeTitle(basename(folder))
  const findings: FolderFinding[] = []
  const playable: Executable[] = []

  for (const exe of executables) {
    const reason = exclusionReason(basename(exe.path), extraExclusions)
    if (reason) findings.push({ path: exe.path, folder, title, excludedReason: reason })
    else playable.push(exe)
  }
  const best = playable.sort((a, b) => score(b, folderKey) - score(a, folderKey))[0]
  if (best) findings.unshift({ path: best.path, folder, title, excludedReason: null })
  return findings
}

export async function scanFolder(
  root: string,
  extraExclusions: string[] = [],
  platform: NodeJS.Platform = process.platform
): Promise<FolderFinding[]> {
  const extensions = EXECUTABLE_EXTENSIONS[platform] ?? EXECUTABLE_EXTENSIONS.linux!
  const findings: FolderFinding[] = []

  // Executables lying directly in the scanned folder are games of their own.
  const top = await entries(root)
  for (const entry of top) {
    const path = join(root, entry.name)
    const ext = extname(entry.name).toLowerCase()
    const isBundle = entry.isDirectory() && ext === '.app' && extensions.includes('.app')
    if ((entry.isFile() && extensions.includes(ext)) || isBundle) {
      const reason = exclusionReason(entry.name, extraExclusions)
      findings.push({
        path,
        folder: root,
        title: prettifyName(basename(entry.name, ext)),
        excludedReason: reason
      })
    }
  }

  for (const entry of top) {
    if (!entry.isDirectory() || extname(entry.name).toLowerCase() === '.app') continue
    if (SKIPPED_DIRS.test(entry.name)) continue
    const folder = join(root, entry.name)
    findings.push(
      ...pickExecutables(folder, await collectExecutables(folder, extensions, 1), extraExclusions)
    )
  }
  return findings
}

/** True when `child` is `parent` or inside it (case-insensitive on Windows/macOS). */
export function isInside(child: string, parent: string): boolean {
  const caseless = process.platform !== 'linux'
  const a = caseless ? child.toLowerCase() : child
  const b = caseless ? parent.toLowerCase() : parent
  const rel = relative(b, a)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel))
}
