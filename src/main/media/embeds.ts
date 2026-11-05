import { session } from 'electron'

/** Hosts the renderer CSP lets the game page embed (see src/renderer/index.html). */
export const YOUTUBE_EMBED = 'https://www.youtube-nocookie.com/embed/'
export const STEAM_VIDEO_CDN = 'https://video.akamai.steamstatic.com/'

/**
 * YouTube refuses embeds without a Referer (player error 153), which a page loaded from
 * file:// never sends: the app identity is sent instead, on the embed requests only.
 */
export function allowYouTubeEmbeds(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${YOUTUBE_EMBED}*`] },
    (details, callback) => {
      callback({
        requestHeaders: { ...details.requestHeaders, Referer: 'https://fr.perso.shelf/' }
      })
    }
  )
}
