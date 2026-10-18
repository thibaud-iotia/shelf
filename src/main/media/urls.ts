// Cached artwork lives in paths.covers() and is served to the renderer through the
// `shelf-media://` protocol (see protocol.ts). The DB only stores file names.

export const MEDIA_SCHEME = 'shelf-media'
export const COVERS_HOST = 'covers'

export function mediaUrl(fileName: string | null | undefined): string | null {
  return fileName ? `${MEDIA_SCHEME}://${COVERS_HOST}/${encodeURIComponent(fileName)}` : null
}
