import { useState, type DragEvent, type FormEvent } from 'react'
import { collectionGames } from '@shared/library'
import type { Collection, Game } from '@shared/models'
import { GAME_DRAG_TYPE } from '@renderer/components/game/GameCard'
import {
  useAddToCollection,
  useCollections,
  useCreateCollection,
  useTags
} from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { useUiStore } from '@renderer/stores/ui'
import { SectionHeading } from './Sidebar'

function CollectionItem({ collection, games }: { collection: Collection; games: Game[] }) {
  const active = useUiStore((s) => s.route.name === 'collection' && s.route.id === collection.id)
  const navigate = useUiStore((s) => s.navigate)
  const add = useAddToCollection()
  const [over, setOver] = useState(false)
  const accepts = (e: DragEvent) =>
    !collection.rules && e.dataTransfer.types.includes(GAME_DRAG_TYPE)

  return (
    <button
      type="button"
      data-testid="sidebar-collection"
      onClick={() => navigate({ name: 'collection', id: collection.id })}
      aria-current={active ? 'page' : undefined}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const id = Number(e.dataTransfer.getData(GAME_DRAG_TYPE))
        if (!id || collection.rules) return
        e.preventDefault()
        add.mutate([collection.id, [id]], {
          onSuccess: () => toast.success(`Ajouté à « ${collection.name} »`)
        })
      }}
      className={`flex items-center gap-2.5 px-3 py-[9px] rounded-[12px] text-sm text-left cursor-pointer transition-colors ${
        active ? 'bg-brand-subtle text-white font-semibold' : 'text-text-mid hover:bg-ink-800'
      } ${over ? 'outline-2 outline-dashed outline-brand bg-brand-subtle' : ''}`}
    >
      {collection.rules && (
        <span aria-label="Intelligente" className="text-xs">
          ✦
        </span>
      )}
      <span className="truncate">{collection.name}</span>
      <span className="ml-auto font-mono text-xs font-medium opacity-70">
        {collectionGames(collection, games).length}
      </span>
    </button>
  )
}

export function SidebarCollections({ games }: { games: Game[] }) {
  const collections = useCollections()
  const tags = useTags()
  const create = useCreateCollection()
  const navigate = useUiStore((s) => s.navigate)
  const tagFilter = useUiStore((s) => s.tagFilter)
  const setTagFilter = useUiStore((s) => s.setTagFilter)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setCreating(false)
    try {
      const created = await create.mutateAsync([name])
      setName('')
      setCreating(false)
      navigate({ name: 'collection', id: created.id })
    } catch {
      // Toast shown by the mutation.
    }
  }

  return (
    <>
      <SectionHeading>COLLECTIONS</SectionHeading>
      {(collections.data ?? []).map((c) => (
        <CollectionItem key={c.id} collection={c} games={games} />
      ))}
      {creating ? (
        <form onSubmit={submit} className="px-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name.trim() && setCreating(false)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            placeholder="Nom de la collection ↵"
            aria-label="Nom de la nouvelle collection"
            className="w-full px-3 py-2 rounded-[12px] bg-inset border border-ink-600 text-sm text-text-hi placeholder:text-text-lo outline-none focus:border-brand"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-3 py-[9px] rounded-[12px] text-sm text-left text-text-lo hover:bg-ink-800 cursor-pointer"
        >
          + nouvelle
        </button>
      )}

      {(tags.data?.length ?? 0) > 0 && (
        <>
          <SectionHeading>TAGS</SectionHeading>
          <div className="flex flex-wrap gap-1.5 px-2">
            {tags.data!.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tagFilter === t.name}
                onClick={() => {
                  setTagFilter(tagFilter === t.name ? null : t.name)
                  navigate({ name: 'library' })
                }}
                className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${
                  tagFilter === t.name
                    ? 'bg-brand text-white'
                    : 'bg-brand-subtle text-red-200 hover:brightness-125'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
