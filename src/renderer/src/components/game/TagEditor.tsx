import { useState } from 'react'
import type { Game } from '@shared/models'
import { useSetTags, useTags } from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

/** Mockup 03 — tag chips (brand-subtle) with a dashed "+ tag" that turns into an input. */
export function TagEditor({ game }: { game: Game }) {
  const setTags = useSetTags()
  const tags = useTags()
  const navigate = useUiStore((s) => s.navigate)
  const setTagFilter = useUiStore((s) => s.setTagFilter)
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')

  const add = () => {
    const name = value.trim().toLowerCase()
    if (name && !game.tags.includes(name)) setTags.mutate([game.id, [...game.tags, name]])
    setValue('')
    setAdding(false)
  }

  return (
    <div data-testid="game-tags" className="flex flex-wrap items-center gap-2">
      {game.tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1.5 pl-3.5 pr-2 py-[5px] rounded-full bg-brand-subtle text-red-200 text-[13px] font-semibold"
        >
          <button
            type="button"
            className="cursor-pointer hover:underline"
            onClick={() => {
              setTagFilter(tag)
              navigate({ name: 'library' })
            }}
          >
            {tag}
          </button>
          <button
            type="button"
            aria-label={`Retirer le tag ${tag}`}
            onClick={() => setTags.mutate([game.id, game.tags.filter((t) => t !== tag)])}
            className="w-4 h-4 rounded-full text-[10px] hover:bg-brand cursor-pointer"
          >
            ✕
          </button>
        </span>
      ))}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input
            autoFocus
            list="known-tags"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            aria-label="Nouveau tag"
            placeholder="tag ↵"
            className="w-32 px-3.5 py-[5px] rounded-full border border-dashed border-ink-400 bg-transparent text-[13px] text-text-hi outline-none focus:border-brand"
          />
          <datalist id="known-tags">
            {(tags.data ?? []).map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="px-3.5 py-[5px] rounded-full border border-dashed border-ink-400 text-[13px] text-text-lo hover:text-text-mid cursor-pointer"
        >
          + tag
        </button>
      )}
    </div>
  )
}
