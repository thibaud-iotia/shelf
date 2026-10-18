// Pure library logic shared by the renderer views and the unit tests:
// filtering, smart collections and the palette's fuzzy search.

import type { Collection, Game, SmartRules } from './models'

export type InstallFilter = 'all' | 'installed' | 'not_installed'

export interface LibraryFilter {
  text?: string
  install?: InstallFilter
  favoritesOnly?: boolean
  tag?: string | null
  showHidden?: boolean
}

/** Lower-case, accent-free form used for every text comparison. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function filterGames(games: Game[], filter: LibraryFilter): Game[] {
  const words = fold(filter.text ?? '')
    .split(/\s+/)
    .filter(Boolean)
  return games.filter((g) => {
    if (g.hidden && !filter.showHidden) return false
    if (filter.install === 'installed' && g.installState !== 'installed') return false
    if (filter.install === 'not_installed' && g.installState === 'installed') return false
    if (filter.favoritesOnly && !g.favorite) return false
    if (filter.tag && !g.tags.includes(filter.tag)) return false
    if (words.length) {
      const haystack = fold([g.title, g.developer ?? '', ...g.genres, ...g.tags].join(' '))
      if (!words.every((w) => haystack.includes(w))) return false
    }
    return true
  })
}

export function matchesRules(game: Game, rules: SmartRules): boolean {
  if (rules.sources?.length && !rules.sources.includes(game.source)) return false
  if (rules.tags?.length && !rules.tags.every((t) => game.tags.includes(t))) return false
  if (rules.genres?.length) {
    const genres = game.genres.map(fold)
    if (!rules.genres.some((g) => genres.includes(fold(g)))) return false
  }
  if (rules.installed !== undefined && (game.installState === 'installed') !== rules.installed) {
    return false
  }
  if (rules.favorite !== undefined && game.favorite !== rules.favorite) return false
  if (rules.neverPlayed && game.sessionCount > 0) return false
  if (rules.minPlaytimeHours !== undefined && game.playtimeSec < rules.minPlaytimeHours * 3600) {
    return false
  }
  return true
}

/** Members of a collection: stored order for manual ones, computed for smart ones. */
export function collectionGames(collection: Collection, games: Game[]): Game[] {
  if (collection.rules) return games.filter((g) => !g.hidden && matchesRules(g, collection.rules!))
  const byId = new Map(games.map((g) => [g.id, g]))
  return collection.gameIds.map((id) => byId.get(id)).filter((g): g is Game => !!g && !g.hidden)
}

export function isEmptyRules(rules: SmartRules): boolean {
  return Object.values(rules).every(
    (v) => v === undefined || v === false || (Array.isArray(v) && v.length === 0)
  )
}

/**
 * Fuzzy score of `query` against `text` (higher is better, null = no match):
 * exact > prefix > word start > substring > in-order subsequence.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query.trim())
  if (!q) return 0
  const t = fold(text)
  if (t === q) return 1000
  if (t.startsWith(q)) return 800 - t.length
  const wordStart = t.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))
  if (wordStart) return 600 - t.length
  const index = t.indexOf(q)
  if (index >= 0) return 400 - index
  let position = 0
  let gaps = 0
  for (const char of q) {
    const found = t.indexOf(char, position)
    if (found < 0) return null
    gaps += found - position
    position = found + 1
  }
  return 200 - gaps
}

export function searchGames(games: Game[], query: string, limit = 6): Game[] {
  return games
    .filter((g) => !g.hidden)
    .map((g) => ({ g, score: fuzzyScore(query, g.title) }))
    .filter((r): r is { g: Game; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || (b.g.lastPlayedAt ?? 0) - (a.g.lastPlayedAt ?? 0))
    .slice(0, limit)
    .map((r) => r.g)
}
