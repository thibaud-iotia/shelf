import { IMAGE_HOSTS, requestBinary, type FetchLike } from '../net/http'
import { MEDIA_SCHEME } from './urls'

// Remote images of the game page (Steam news, community shares, achievement icons,
// video posters) are served as `shelf-media://remote/<base64url of the https URL>`:
// the main process downloads them through net/http.ts, so the renderer CSP keeps
// `img-src 'self' data: shelf-media:` and never reaches the network itself.

export const REMOTE_HOST = 'remote'

function allowedImageUrl(url: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return parsed.protocol === 'https:' && IMAGE_HOSTS.has(parsed.hostname) ? parsed : null
}

/** Proxy URL of a remote image, or null when its host is not an allowed image CDN. */
export function remoteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const parsed = allowedImageUrl(url)
  if (!parsed) return null
  return `${MEDIA_SCHEME}://${REMOTE_HOST}/${Buffer.from(parsed.toString()).toString('base64url')}`
}

/** Original https URL behind a proxy URL, or null for anything else. */
export function parseRemoteImageUrl(mediaUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(mediaUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== REMOTE_HOST) return null
  const token = parsed.pathname.replace(/^\/+/, '')
  if (!/^[\w-]+$/.test(token)) return null
  const url = Buffer.from(token, 'base64url').toString()
  return allowedImageUrl(url) ? url : null
}

export interface RemoteImage {
  data: Buffer
  contentType: string
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Small in-memory LRU of downloaded images (they change rarely and the page is often
 * reopened). Concurrent requests for the same URL share one download.
 */
export class RemoteImageCache {
  private readonly entries = new Map<string, RemoteImage>()
  private readonly pending = new Map<string, Promise<RemoteImage>>()
  private bytes = 0

  constructor(
    private readonly fetch?: FetchLike,
    private readonly maxBytes = 64 * 1024 * 1024
  ) {}

  get size(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes }
  }

  async get(url: string): Promise<RemoteImage> {
    const hit = this.entries.get(url)
    if (hit) {
      this.entries.delete(url)
      this.entries.set(url, hit)
      return hit
    }
    let request = this.pending.get(url)
    if (!request) {
      request = this.download(url).finally(() => this.pending.delete(url))
      this.pending.set(url, request)
    }
    return request
  }

  private async download(url: string): Promise<RemoteImage> {
    const { data, contentType } = await requestBinary(url, {
      service: 'images',
      fetch: this.fetch
    })
    const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!type.startsWith('image/')) throw new Error(`Not an image: ${type || 'unknown'}`)
    const image = { data, contentType: type }
    if (data.byteLength <= MAX_IMAGE_BYTES) this.store(url, image)
    return image
  }

  private store(url: string, image: RemoteImage): void {
    this.entries.set(url, image)
    this.bytes += image.data.byteLength
    for (const [key, value] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      this.entries.delete(key)
      this.bytes -= value.data.byteLength
    }
  }
}
