import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { extname, join } from 'node:path'
import { AppError } from '../../shared/errors'
import type { CacheInfo } from '../../shared/models'
import { requestBinary, type FetchLike } from '../net/http'
import { IMAGE_RULES, type ImageKind, type ImageShrinker } from './shrink-policy'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

const SAFE_NAME = /^[\w.-]+$/

/** File names stored in the DB are plain names inside the covers folder. */
export function isSafeMediaName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.startsWith('.')
}

/**
 * Maps `shelf-media://covers/<name>` to a file of the covers folder, or null for any
 * other host, a traversal attempt or a missing file.
 */
export function resolveMediaPath(dir: string, url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.hostname !== 'covers') return null
  let name: string
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!isSafeMediaName(name)) return null
  const path = join(dir, name)
  return existsSync(path) ? path : null
}

/** Local artwork cache in userData/covers. */
export class MediaCache {
  constructor(
    private readonly dir: string,
    private readonly fetch?: FetchLike,
    /** Stores artwork at its display size (Electron's codec in the app, none in unit tests). */
    private readonly shrink?: ImageShrinker
  ) {}

  /** The image for its use, or the downloaded bytes when they cannot be made smaller. */
  private async fitted(
    data: Uint8Array,
    extension: string,
    kind: ImageKind | undefined
  ): Promise<{ data: Uint8Array; extension: string }> {
    if (!kind || !this.shrink) return { data, extension }
    const shrunk = await this.shrink(data, kind).catch(() => null)
    return shrunk ?? { data, extension }
  }

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true })
  }

  /** Unique name per download so the renderer never shows a stale cached image. */
  static fileName(prefix: string, extension: string): string {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${extension}`
  }

  /** Downloads an image; with a `kind`, it is stored at its display size. */
  async download(url: string, prefix: string, kind?: ImageKind): Promise<string> {
    const { data, contentType } = await requestBinary(url, { service: 'images', fetch: this.fetch })
    const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
    const extension = EXTENSIONS[type] ?? (extname(new URL(url).pathname).toLowerCase() || '.jpg')
    if (!Object.values(EXTENSIONS).includes(extension)) {
      throw new AppError('NETWORK', `Format d’image non pris en charge : ${type || extension}`)
    }
    const image = await this.fitted(data, extension, kind)
    this.ensureDir()
    const name = MediaCache.fileName(prefix, image.extension)
    writeFileSync(join(this.dir, name), image.data)
    return name
  }

  /**
   * Shrinks a file downloaded before artwork was resized. Returns the new file name (the old
   * file is removed), or null when the file is missing, already small or cannot be shrunk.
   */
  async compact(name: string, kind: ImageKind, prefix: string): Promise<string | null> {
    if (!this.shrink || !isSafeMediaName(name)) return null
    const path = join(this.dir, name)
    if (!existsSync(path) || statSync(path).size <= IMAGE_RULES[kind].compactAbove) return null
    const shrunk = await this.shrink(readFileSync(path), kind).catch(() => null)
    if (!shrunk) return null
    const next = MediaCache.fileName(prefix, shrunk.extension)
    writeFileSync(join(this.dir, next), shrunk.data)
    rmSync(path, { force: true })
    return next
  }

  /** Same file, kept across calls (match thumbnails). */
  async downloadOnce(url: string, name: string): Promise<string> {
    if (!isSafeMediaName(name)) throw new AppError('VALIDATION', 'Nom de fichier invalide.')
    if (existsSync(join(this.dir, name))) return name
    const { data } = await requestBinary(url, { service: 'images', fetch: this.fetch })
    this.ensureDir()
    writeFileSync(join(this.dir, name), data)
    return name
  }

  importFile(source: string, prefix: string): string {
    const extension = extname(source).toLowerCase()
    if (!Object.values(EXTENSIONS).includes(extension)) {
      throw new AppError('VALIDATION', 'Choisissez une image JPG, PNG, WebP ou GIF.')
    }
    this.ensureDir()
    const name = MediaCache.fileName(prefix, extension)
    copyFileSync(source, join(this.dir, name))
    return name
  }

  remove(names: (string | null | undefined)[]): void {
    for (const name of names) {
      if (name && isSafeMediaName(name)) rmSync(join(this.dir, name), { force: true })
    }
  }

  info(): CacheInfo {
    if (!existsSync(this.dir)) return { bytes: 0, files: 0 }
    let bytes = 0
    let files = 0
    for (const name of readdirSync(this.dir)) {
      const stat = statSync(join(this.dir, name))
      if (stat.isFile()) {
        bytes += stat.size
        files++
      }
    }
    return { bytes, files }
  }

  clear(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
