import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { resolveMediaPath } from './cache'
import { parseRemoteImageUrl, REMOTE_HOST, type RemoteImageCache } from './remote'
import { MEDIA_SCHEME } from './urls'

/** Must run before `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Serves cached artwork read-only from the covers folder, and remote images of allowed
 * CDNs through the main process (`shelf-media://remote/…`).
 */
export function handleMediaProtocol(coversDir: () => string, remote: RemoteImageCache): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (new URL(request.url).hostname === REMOTE_HOST) {
      const url = parseRemoteImageUrl(request.url)
      if (!url) return new Response('Not found', { status: 404 })
      try {
        const image = await remote.get(url)
        return new Response(new Uint8Array(image.data), {
          headers: { 'content-type': image.contentType, 'cache-control': 'max-age=3600' }
        })
      } catch {
        return new Response('Unavailable', { status: 502 })
      }
    }
    const path = resolveMediaPath(coversDir(), request.url)
    if (!path) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString())
  })
}
