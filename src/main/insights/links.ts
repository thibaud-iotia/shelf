import type { GameLink, GameVideo, LinkKind } from '../../shared/models'
import { remoteImageUrl } from '../media/remote'

const LABELS: Record<LinkKind, string> = {
  official: 'Site officiel',
  steam: 'Page Steam',
  community: 'Communauté Steam',
  wiki: 'Wiki',
  discord: 'Discord',
  reddit: 'Reddit',
  twitter: 'X (Twitter)',
  youtube: 'YouTube',
  twitch: 'Twitch',
  other: 'Lien'
}

const ORDER: LinkKind[] = [
  'official',
  'steam',
  'community',
  'wiki',
  'discord',
  'reddit',
  'youtube',
  'twitch',
  'twitter',
  'other'
]

/** Kind of a link from its host only (IGDB's website categories changed over time). */
export function linkKind(url: URL): LinkKind {
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'store.steampowered.com') return 'steam'
  if (host === 'steamcommunity.com') return 'community'
  if (
    /(^|\.)(fandom\.com|wikia\.com|wikipedia\.org|wiki\.gg)$/.test(host) ||
    /^wiki\./.test(host)
  ) {
    return 'wiki'
  }
  if (/(^|\.)(discord\.gg|discord\.com)$/.test(host)) return 'discord'
  if (/(^|\.)reddit\.com$/.test(host)) return 'reddit'
  if (/(^|\.)(twitter\.com|x\.com)$/.test(host)) return 'twitter'
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube'
  if (/(^|\.)twitch\.tv$/.test(host)) return 'twitch'
  return 'other'
}

function parseLink(raw: string | null | undefined): URL | null {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol === 'http:') url.protocol = 'https:'
    return url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * Useful links of a game, de-duplicated and sorted. `official` is the store's website;
 * the other URLs (IGDB) are classified by host. Wikipedia pages are labelled as such.
 */
export function buildLinks(official: string | null | undefined, others: string[]): GameLink[] {
  const seen = new Set<string>()
  const links: GameLink[] = []
  const add = (url: URL, kind: LinkKind) => {
    const key = url.toString().replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const label = url.hostname.endsWith('wikipedia.org')
      ? 'Wikipédia'
      : kind === 'other'
        ? url.hostname.replace(/^www\./, '')
        : LABELS[kind]
    links.push({ kind, label, url: url.toString() })
  }
  const site = parseLink(official)
  if (site) add(site, linkKind(site) === 'other' ? 'official' : linkKind(site))
  for (const raw of others) {
    const url = parseLink(raw)
    if (url) add(url, linkKind(url))
  }
  return links.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

const YOUTUBE_ID = /^[\w-]{6,20}$/

/** IGDB videos are YouTube ids: privacy-enhanced embed + proxied thumbnail. */
export function youtubeVideos(videos: { video_id?: string; name?: string }[]): GameVideo[] {
  return videos
    .filter(
      (v): v is { video_id: string; name?: string } => !!v.video_id && YOUTUBE_ID.test(v.video_id)
    )
    .map((v) => ({
      id: `youtube-${v.video_id}`,
      title: v.name?.trim() || 'Vidéo',
      kind: 'youtube' as const,
      posterUrl: remoteImageUrl(`https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`),
      sources: [`https://www.youtube-nocookie.com/embed/${v.video_id}?autoplay=1&rel=0`],
      pageUrl: `https://www.youtube.com/watch?v=${v.video_id}`
    }))
}
