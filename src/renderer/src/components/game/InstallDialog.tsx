import { useEffect, useState } from 'react'
import { freeSpaceLabel } from '@shared/install'
import type { Game, InstallLocation, InstallLocations } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import {
  useGames,
  useInstallGame,
  useInstallLocations,
  usePickInstallFolder
} from '@renderer/lib/queries'
import { useUiStore } from '@renderer/stores/ui'

const samePath = (a: string, b: string) =>
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

function LocationOption({
  location,
  checked,
  onSelect
}: {
  location: InstallLocation
  checked: boolean
  onSelect: () => void
}) {
  const free = freeSpaceLabel(location)
  return (
    <label
      className={`flex items-center gap-3 px-3.5 py-3 rounded-md border cursor-pointer ${
        checked ? 'border-brand bg-ink-700' : 'border-ink-600 bg-ink-700/40 hover:bg-ink-700'
      }`}
    >
      <input
        type="radio"
        name="install-location"
        className="accent-brand"
        checked={checked}
        onChange={onSelect}
      />
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-mono text-xs text-text-hi break-all">{location.path}</span>
        {location.kind === 'newLibrary' && (
          <span className="text-xs text-text-lo">
            Nouvelle bibliothèque Steam : ajoutée pendant le redémarrage de Steam.
          </span>
        )}
      </span>
      {free && <span className="flex-none text-xs font-medium text-text-mid">{free}</span>}
    </label>
  )
}

function InstallDialogBody({
  game,
  options,
  onClose
}: {
  game: Game
  options: InstallLocations
  onClose: () => void
}) {
  const install = useInstallGame()
  const pick = usePickInstallFolder()
  const [extra, setExtra] = useState<InstallLocation[]>([])
  const [selected, setSelected] = useState(options.defaultPath)
  const [notice, setNotice] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const steam = options.source === 'steam'
  const locations = [
    ...options.locations,
    ...extra.filter((e) => !options.locations.some((l) => samePath(l.path, e.path)))
  ]

  const pickFolder = () =>
    pick.mutate(options.source, {
      onSuccess: (picked) => {
        if (!picked) return
        const { location } = picked
        setExtra((list) => [...list.filter((l) => !samePath(l.path, location.path)), location])
        setSelected(location.path)
        setNotice(picked.notice)
      }
    })

  const confirm = () =>
    install.mutate([game.id, { path: selected, remember }], { onSuccess: onClose })

  return (
    <Modal
      title={`Installer « ${game.title} »`}
      onClose={onClose}
      width={580}
      footer={
        <>
          <span className="text-xs text-text-lo">Modifiable dans Réglages › Système</span>
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={confirm} disabled={install.isPending}>
            Installer
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[11px] font-semibold tracking-[.12em] text-text-lo">
          EMPLACEMENT
        </legend>
        {locations.map((location) => (
          <LocationOption
            key={location.path}
            location={location}
            checked={samePath(location.path, selected)}
            onSelect={() => {
              setSelected(location.path)
              setNotice(null)
            }}
          />
        ))}
        <Button
          variant="secondary"
          size="sm"
          className="self-start mt-1"
          onClick={pickFolder}
          disabled={pick.isPending}
        >
          Autre dossier…
        </Button>
      </fieldset>
      {notice && (
        <p role="status" className="text-sm text-amber-300">
          {notice}
        </p>
      )}
      <p className="text-xs text-text-lo">
        {steam
          ? 'Steam installe le jeu dans le dossier steamapps/common de la bibliothèque choisie.'
          : 'Le jeu est installé dans un sous-dossier de l’emplacement choisi.'}
      </p>
      <label className="flex items-center gap-2.5 text-sm text-text-mid cursor-pointer">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Toujours installer ici, sans demander
      </label>
    </Modal>
  )
}

/** "Installer" on a Steam / Epic game: where to install it, before it starts. */
export function InstallDialog() {
  const id = useUiStore((s) => s.installDialogGameId)
  const close = useUiStore((s) => s.closeInstallDialog)
  const games = useGames()
  const game = games.data?.find((g) => g.id === id)
  const locations = useInstallLocations(game?.source ?? null)
  const install = useInstallGame()
  const unavailable = !!game && locations.isSuccess && locations.data === null

  // No background install possible (Steam missing, Legendary not logged in): the launcher.
  useEffect(() => {
    if (!unavailable || !game) return
    install.mutate([game.id])
    close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable, game?.id])

  if (id === null || !game || unavailable) return null
  if (!locations.data) {
    return (
      <Modal title={`Installer « ${game.title} »`} onClose={close} width={580}>
        <p role="status" className="text-sm text-text-mid">
          {locations.isError ? locations.error.message : 'Recherche des emplacements…'}
        </p>
      </Modal>
    )
  }
  return <InstallDialogBody key={game.id} game={game} options={locations.data} onClose={close} />
}
