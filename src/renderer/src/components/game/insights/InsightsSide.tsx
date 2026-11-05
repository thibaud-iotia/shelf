import type { GameInsights, ReviewSummary } from '@shared/models'
import { formatCount } from '@shared/format'
import { ExternalLink, SectionLabel } from './common'

function reviewColor(score: number): string {
  if (score >= 6) return 'text-green-300!'
  if (score === 5) return 'text-amber-300!'
  return 'text-red-300!'
}

function Reviews({ reviews }: { reviews: ReviewSummary }) {
  return (
    <div data-testid="reviews" className="flex flex-col gap-0.5">
      <ExternalLink
        href={reviews.url}
        className={`font-semibold first-letter:uppercase hover:underline ${reviewColor(reviews.score)}`}
      >
        {reviews.label}
      </ExternalLink>
      <span className="text-[13px] text-text-lo">
        {reviews.percentPositive} % de {formatCount(reviews.count)} évaluations
      </span>
    </div>
  )
}

/** Steam-like facts of the side card: reviews, players online, Metacritic, links. */
export function InsightsSide({ insights }: { insights: GameInsights }) {
  const { reviews, playersOnline, metacritic, links } = insights
  if (!reviews && playersOnline === null && !metacritic && links.length === 0) return null
  return (
    <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-ink-600">
      {reviews && (
        <>
          <SectionLabel>ÉVALUATIONS STEAM</SectionLabel>
          <Reviews reviews={reviews} />
        </>
      )}
      {playersOnline !== null && (
        <span
          data-testid="players-online"
          className="flex items-center gap-2 text-sm text-text-mid"
        >
          <i className="w-2 h-2 rounded-full bg-green-300" />
          {formatCount(playersOnline)} {playersOnline > 1 ? 'joueurs' : 'joueur'} en ligne
        </span>
      )}
      {metacritic && (
        <span className="text-sm text-text-mid">
          Metacritic{' '}
          {metacritic.url ? (
            <ExternalLink
              href={metacritic.url}
              className="font-semibold text-text-hi! hover:underline"
            >
              {metacritic.score}
            </ExternalLink>
          ) : (
            <b className="text-text-hi">{metacritic.score}</b>
          )}
        </span>
      )}
      {links.length > 0 && (
        <>
          <SectionLabel>LIENS</SectionLabel>
          <ul data-testid="links" className="flex flex-col gap-1.5">
            {links.map((link) => (
              <li key={link.url}>
                <ExternalLink
                  href={link.url}
                  title={link.url}
                  className="text-sm text-text-mid! hover:text-text-hi!"
                >
                  {link.label} ↗
                </ExternalLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
