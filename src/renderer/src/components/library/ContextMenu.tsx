import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { usePlay } from '@renderer/lib/actions'
import {
  useAddToCollection,
  useCollections,
  useGames,
  useInstallGame,
  useOpenFolder,
  useRemoveFromCollection,
  useSetTags,
  useTags,
  useUpdateGame
} from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

function Item({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-sm text-sm text-text-hi hover:bg-ink-700 focus-visible:bg-ink-700 outline-none cursor-pointer"
    >
      {children}
    </button>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-[.12em] text-text-lo">
      {children}
    </div>
  )
}

// Mockup 07 — right click on a cover: actions, tags, collections.
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu)
  const close = useUiStore((s) => s.closeContextMenu)
  const openGameForm = useUiStore((s) => s.openGameForm)
  const games = useGames()
  const tags = useTags()
  const collections = useCollections()
  const update = useUpdateGame()
  const setTags = useSetTags()
  const addTo = useAddToCollection()
  const removeFrom = useRemoveFromCollection()
  const openFolder = useOpenFolder()
  const install = useInstallGame()
  const play = usePlay()
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [newTag, setNewTag] = useState('')

  const game = games.data?.find((g) => g.id === menu?.gameId)

  useLayoutEffect(() => {
    if (!menu || !panel.current) return
    const { offsetWidth: w, offsetHeight: h } = panel.current
    setPosition({
      x: Math.min(menu.x, window.innerWidth - w - 8),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8))
    })
    panel.current.querySelector<HTMLElement>('[role=menuitem]')?.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu, close])

  if (!menu || !game) return null

  const run = (fn: () => void) => () => {
    fn()
    close()
  }
  const toggleTag = (name: string) =>
    setTags.mutate([
      game.id,
      game.tags.includes(name) ? game.tags.filter((t) => t !== name) : [...game.tags, name]
    ])
  const allTags = [...new Set([...(tags.data ?? []).map((t) => t.name), ...game.tags])].sort()
  const manual = (collections.data ?? []).filter((c) => !c.rules)

  return (
    <div
      ref={panel}
      role="menu"
      aria-label={`Actions pour ${game.title}`}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 w-[260px] max-h-[calc(100vh-16px)] overflow-auto p-1.5 rounded-md bg-ink-800 border border-ink-600 shadow-[0_20px_60px_rgba(0,0,0,.6)]"
    >
      {game.installState === 'not_installed' && game.canInstall ? (
        <Item onClick={run(() => install.mutate(game.id))}>⤓ Installer</Item>
      ) : (
        <Item onClick={run(() => void play(game))}>▶ Jouer</Item>
      )}
      <Item onClick={run(() => update.mutate([game.id, { favorite: !game.favorite }]))}>
        {game.favorite ? '♡ Retirer des favoris' : '♥ Favori'}
      </Item>
      <Item onClick={run(() => openFolder.mutate(game.id))}>Ouvrir le dossier</Item>
      <Item onClick={run(() => openGameForm({ mode: 'edit', gameId: game.id }))}>Modifier…</Item>
      <Item onClick={run(() => update.mutate([game.id, { hidden: !game.hidden }]))}>
        {game.hidden ? 'Afficher' : 'Masquer'}
      </Item>

      <div className="my-1.5 h-px bg-ink-600" />
      <Heading>TAGS</Heading>
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {allTags.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={game.tags.includes(name)}
            onClick={() => toggleTag(name)}
            className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer ${
              game.tags.includes(name)
                ? 'bg-brand text-white'
                : 'bg-ink-700 text-text-mid hover:text-text-hi'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <form
        className="px-2 pb-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          const name = newTag.trim().toLowerCase()
          if (name && !game.tags.includes(name)) setTags.mutate([game.id, [...game.tags, name]])
          setNewTag('')
        }}
      >
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="nouveau tag… ↵"
          aria-label="Nouveau tag"
          className="w-full px-2.5 py-1.5 rounded-sm bg-inset border border-ink-600 text-sm text-text-hi placeholder:text-text-lo outline-none focus:border-brand"
        />
      </form>

      {manual.length > 0 && (
        <>
          <Heading>COLLECTIONS</Heading>
          {manual.map((c) => {
            const member = game.collectionIds.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={member}
                onClick={() =>
                  member ? removeFrom.mutate([c.id, game.id]) : addTo.mutate([c.id, [game.id]])
                }
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-sm text-text-hi hover:bg-ink-700 cursor-pointer"
              >
                <i
                  className={`not-italic w-4 h-4 rounded-[5px] flex items-center justify-center text-[11px] ${
                    member ? 'bg-brand text-white' : 'border border-ink-400'
                  }`}
                >
                  {member ? '✓' : ''}
                </i>
                {c.name}
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
