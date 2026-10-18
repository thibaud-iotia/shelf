import { useMemo, useState, type FormEvent } from 'react'
import { GAME_SOURCES, SOURCE_LABELS } from '@shared/domain'
import { pluralize } from '@shared/format'
import { collectionGames } from '@shared/library'
import type { Collection, SmartRules } from '@shared/models'
import { GameGrid } from '@renderer/components/game/GameGrid'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { useGameContextMenu, usePlay } from '@renderer/lib/actions'
import {
  useAddToCollection,
  useCollections,
  useDeleteCollection,
  useGames,
  useSettings,
  useTags,
  useUpdateCollection
} from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

function RulesEditor({ collection }: { collection: Collection }) {
  const update = useUpdateCollection()
  const tags = useTags()
  const rules = collection.rules ?? {}
  const set = (patch: Partial<SmartRules>) => {
    const next: SmartRules = { ...rules, ...patch }
    for (const key of Object.keys(next) as (keyof SmartRules)[]) {
      const value = next[key]
      if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key]
    }
    update.mutate([collection.id, { rules: next }])
  }
  const toggle = <T,>(list: T[] | undefined, value: T) =>
    list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value]
  const tri = (value: boolean | undefined) =>
    value === undefined ? true : value ? false : undefined
  const triLabel = (value: boolean | undefined, yes: string, no: string, any: string) =>
    value === undefined ? any : value ? yes : no

  return (
    <div
      data-testid="rules-editor"
      className="flex flex-col gap-3 p-5 rounded-lg bg-ink-800 border border-ink-600"
    >
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">
        RÈGLES — TOUTES DOIVENT CORRESPONDRE
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-sm text-text-mid">Sources</span>
        {GAME_SOURCES.map((s) => (
          <Chip
            key={s}
            active={!!rules.sources?.includes(s)}
            onClick={() => set({ sources: toggle(rules.sources, s) })}
          >
            {SOURCE_LABELS[s]}
          </Chip>
        ))}
      </div>
      {(tags.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm text-text-mid">Tags</span>
          {tags.data!.map((t) => (
            <Chip
              key={t.id}
              variant="tag"
              active={!!rules.tags?.includes(t.name)}
              onClick={() => set({ tags: toggle(rules.tags, t.name) })}
            >
              {t.name}
            </Chip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-sm text-text-mid">État</span>
        <Chip
          active={rules.installed !== undefined}
          onClick={() => set({ installed: tri(rules.installed) })}
        >
          {triLabel(rules.installed, 'Installés', 'Non installés', 'Installés ou non')}
        </Chip>
        <Chip
          active={rules.favorite !== undefined}
          onClick={() => set({ favorite: tri(rules.favorite) })}
        >
          {triLabel(rules.favorite, '♥ Favoris', 'Hors favoris', 'Favoris ou non')}
        </Chip>
        <Chip
          active={!!rules.neverPlayed}
          onClick={() => set({ neverPlayed: rules.neverPlayed ? undefined : true })}
        >
          Jamais lancés
        </Chip>
      </div>
    </div>
  )
}

function AddGamesDialog({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const games = useGames()
  const add = useAddToCollection()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const candidates = (games.data ?? []).filter(
    (g) => !collection.gameIds.includes(g.id) && g.title.toLowerCase().includes(query.toLowerCase())
  )
  return (
    <Modal
      title={`Ajouter à « ${collection.name} »`}
      onClose={onClose}
      footer={
        <>
          <span className="ml-auto" />
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => add.mutate([collection.id, picked], { onSuccess: onClose })}
          >
            Ajouter ({picked.length})
          </Button>
        </>
      }
    >
      <Input label="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="flex flex-col max-h-[340px] overflow-auto">
        {candidates.map((g) => (
          <li key={g.id}>
            <label className="flex items-center gap-3 px-2 py-2 rounded-sm hover:bg-ink-700 cursor-pointer">
              <input
                type="checkbox"
                checked={picked.includes(g.id)}
                onChange={(e) =>
                  setPicked((p) =>
                    e.target.checked ? [...p, g.id] : p.filter((id) => id !== g.id)
                  )
                }
              />
              <span className="text-sm text-text-hi">{g.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

// Mockup 06 — collection header, manual / smart switch, 5-column grid with a "+" tile.
export function CollectionView({ id }: { id: number }) {
  const collections = useCollections()
  const games = useGames()
  const settings = useSettings()
  const update = useUpdateCollection()
  const remove = useDeleteCollection()
  const navigate = useUiStore((s) => s.navigate)
  const play = usePlay()
  const contextMenu = useGameContextMenu()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const collection = collections.data?.find((c) => c.id === id)
  const members = useMemo(
    () => (collection ? collectionGames(collection, games.data ?? []) : []),
    [collection, games.data]
  )
  if (!collection) {
    return collections.isSuccess ? (
      <p className="px-7 py-6 text-text-lo">Cette collection n’existe plus.</p>
    ) : null
  }
  const smart = collection.rules !== null

  const rename = (e: FormEvent) => {
    e.preventDefault()
    update.mutate([collection.id, { name }], { onSuccess: () => setRenaming(false) })
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-[18px] px-7 py-6">
      <header className="flex items-center gap-3">
        {renaming ? (
          <form onSubmit={rename} className="flex items-end gap-2">
            <Input
              label="Nom de la collection"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm">
              OK
            </Button>
          </form>
        ) : (
          <>
            <h1 className="font-display font-bold text-[28px] tracking-[-.02em] text-text-hi">
              {collection.name}
            </h1>
            <span data-testid="game-count" className="text-text-lo">
              {pluralize(members.length, 'jeu', 'jeux')}
            </span>
          </>
        )}
        <span className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setName(collection.name)
              setRenaming(true)
            }}
          >
            Renommer
          </Button>
          {confirmDelete ? (
            <Button
              variant="outline"
              onClick={() =>
                remove.mutate([collection.id], {
                  onSuccess: () => navigate({ name: 'library' })
                })
              }
            >
              Confirmer la suppression
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Supprimer
            </Button>
          )}
        </span>
      </header>

      <div role="radiogroup" aria-label="Type de collection" className="flex gap-2">
        <Chip
          role="radio"
          aria-checked={!smart}
          active={!smart}
          onClick={() => smart && update.mutate([collection.id, { rules: null }])}
        >
          Manuelle
        </Chip>
        <Chip
          role="radio"
          aria-checked={smart}
          active={smart}
          onClick={() => !smart && update.mutate([collection.id, { rules: {} }])}
        >
          Intelligente (règles)
        </Chip>
      </div>

      {smart && <RulesEditor collection={collection} />}

      <GameGrid
        games={members}
        coverSize={settings.data?.coverSize === 'lg' ? 'lg' : 'md'}
        onOpen={(g) => navigate({ name: 'game', id: g.id })}
        onPlay={play}
        onContextMenu={contextMenu}
        trailing={
          !smart && (
            <button
              type="button"
              aria-label="Ajouter des jeux"
              onClick={() => setAdding(true)}
              className="aspect-[3/4] rounded-md border-[1.5px] border-dashed border-ink-500 text-4xl text-text-lo hover:text-text-mid hover:border-ink-400 cursor-pointer"
            >
              +
            </button>
          )
        }
      />
      <p className="text-[13px] text-text-lo">
        {smart
          ? 'Les jeux apparaissent automatiquement selon les règles.'
          : 'Glissez une jaquette sur une collection pour l’ajouter · clic droit pour les tags'}
      </p>
      {adding && <AddGamesDialog collection={collection} onClose={() => setAdding(false)} />}
    </section>
  )
}
