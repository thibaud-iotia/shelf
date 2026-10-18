import { useDeferredValue } from 'react'
import type { MetadataMatch } from '@shared/models'
import { placeholderGradient } from '@renderer/lib/artwork'
import { useMetadataSearch } from '@renderer/lib/queries'

interface MatchPickerProps {
  title: string
  /** undefined = automatic, null = none. */
  selected: number | null | undefined
  onSelect: (igdbId: number | null, name?: string) => void
}

function Tile({
  label,
  thumb,
  active,
  onClick,
  testId
}: {
  label: string
  thumb: string | null | 'none'
  active: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`w-[132px] flex-none flex flex-col items-center gap-2 p-3 rounded-md border-2 cursor-pointer transition-[border-color,box-shadow] ${
        active
          ? 'border-brand bg-brand-subtle shadow-glow-brand'
          : 'border-transparent hover:border-ink-500'
      }`}
    >
      <div
        className="relative w-[72px] aspect-[3/4] rounded-[10px] overflow-hidden"
        style={{
          background: thumb === 'none' ? 'var(--ink-700)' : placeholderGradient(label)
        }}
      >
        {thumb && thumb !== 'none' && (
          <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
      </div>
      <span className="text-xs text-center text-text-hi leading-tight">{label}</span>
    </button>
  )
}

const label = (m: MetadataMatch) => `${m.name}${m.year ? ` (${m.year})` : ''}`

/** Mockup 04: IGDB correspondences for one detected executable. */
export function MatchPicker({ title, selected, onSelect }: MatchPickerProps) {
  const query = useDeferredValue(title)
  const search = useMetadataSearch(query)
  const matches = search.data?.slice(0, 3) ?? []

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">
        CORRESPONDANCE IGDB
      </span>
      {search.isError && <p className="text-xs text-amber-300">{search.error.message}</p>}
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Correspondances IGDB">
        {search.isPending && query.trim() && (
          <span className="text-sm text-text-lo py-6">Recherche sur IGDB…</span>
        )}
        {matches.map((m, index) => (
          <Tile
            key={m.igdbId}
            testId="igdb-match"
            label={`${label(m)}${selected === undefined && index === 0 ? ' ◉' : ''}`}
            thumb={m.thumbUrl}
            active={selected === m.igdbId}
            onClick={() => onSelect(m.igdbId, m.name)}
          />
        ))}
        <Tile
          label="Aucun / saisir"
          thumb="none"
          active={selected === null}
          onClick={() => onSelect(null)}
        />
      </div>
    </div>
  )
}
