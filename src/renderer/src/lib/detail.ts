import type { GameInsights } from '@shared/models'

export type DetailTab = 'overview' | 'news' | 'videos' | 'community' | 'achievements'

/**
 * Tabs worth showing: the Steam ones need a Steam page, videos need at least one. Community
 * and achievements belong to library games only.
 */
export function availableTabs(
  insights: GameInsights | undefined,
  library = true
): { id: DetailTab; label: string }[] {
  const tabs: { id: DetailTab; label: string }[] = [{ id: 'overview', label: 'Aperçu' }]
  if (!insights) return tabs
  const steam = insights.steamAppId !== null
  if (steam) tabs.push({ id: 'news', label: 'Actualités' })
  if (insights.videos.length) {
    tabs.push({ id: 'videos', label: `Vidéos · ${insights.videos.length}` })
  }
  if (steam && library) tabs.push({ id: 'community', label: 'Communauté' })
  if (steam && library && insights.achievementsTotal) {
    tabs.push({ id: 'achievements', label: `Succès · ${insights.achievementsTotal}` })
  }
  return tabs
}
