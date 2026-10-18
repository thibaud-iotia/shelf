import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { resolveMediaPath } from './cache'
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

/** Serves cached artwork read-only from the covers folder. */
export function handleMediaProtocol(coversDir: () => string): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const path = resolveMediaPath(coversDir(), request.url)
    if (!path) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString())
  })
}
