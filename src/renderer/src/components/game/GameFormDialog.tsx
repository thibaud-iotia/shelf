import { useState, type FormEvent } from 'react'
import { SOURCE_LABELS } from '@shared/domain'
import type { Game } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { call } from '@renderer/lib/ipc'
import {
  useAppInfo,
  useCreateGame,
  useDeleteGame,
  useGames,
  useUpdateGame
} from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { useUiStore, type GameForm } from '@renderer/stores/ui'

interface Fields {
  title: string
  executablePath: string
  launchArgs: string
  installPath: string
  useRunner: boolean
}

function initialFields(game: Game | undefined): Fields {
  return {
    title: game?.title ?? '',
    executablePath: game?.executablePath ?? '',
    launchArgs: game?.launchArgs ?? '',
    installPath: game?.installPath ?? '',
    useRunner: game?.useRunner ?? false
  }
}

function GameFormBody({ form, game }: { form: GameForm; game: Game | undefined }) {
  const close = useUiStore((s) => s.closeGameForm)
  const navigate = useUiStore((s) => s.navigate)
  const route = useUiStore((s) => s.route)
  const info = useAppInfo()
  const create = useCreateGame()
  const update = useUpdateGame()
  const remove = useDeleteGame()
  const [fields, setFields] = useState<Fields>(() => initialFields(game))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = form.mode === 'edit'
  const isManual = !game || game.source === 'manual'
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((f) => ({ ...f, [key]: value }))

  const browse = async () => {
    try {
      const picked = await call('games:pickExecutable')
      if (!picked) return
      setFields((f) => ({
        ...f,
        executablePath: picked.path,
        installPath: f.installPath || picked.installPath,
        title: f.title || picked.suggestedTitle
      }))
    } catch (e) {
      toast.error(e)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const common = {
      launchArgs: fields.launchArgs || null,
      installPath: fields.installPath || null
    }
    try {
      if (form.mode === 'create') {
        const created = await create.mutateAsync([
          { title: fields.title, executablePath: fields.executablePath, ...common }
        ])
        toast.success(`« ${created.title} » ajouté à la bibliothèque`)
      } else {
        await update.mutateAsync([
          form.gameId,
          {
            title: fields.title,
            ...common,
            ...(isManual || fields.executablePath
              ? { executablePath: fields.executablePath || null }
              : {}),
            ...(info.data?.platform === 'linux' ? { useRunner: fields.useRunner } : {})
          }
        ])
      }
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const doDelete = async () => {
    if (form.mode !== 'edit') return
    await remove.mutateAsync([form.gameId])
    toast.info(`« ${game?.title} » supprimé`)
    if (route.name === 'game' && route.id === form.gameId) navigate({ name: 'library' })
    close()
  }

  const busy = create.isPending || update.isPending

  return (
    <Modal
      title={isEdit ? 'Modifier le jeu' : 'Ajouter un jeu'}
      onClose={close}
      footer={
        <>
          {isEdit &&
            (confirmDelete ? (
              <Button variant="outline" size="sm" onClick={doDelete}>
                Confirmer la suppression
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </Button>
            ))}
          <span className="ml-auto" />
          <Button variant="ghost" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" form="game-form" disabled={busy}>
            {isEdit ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }
    >
      <form id="game-form" onSubmit={submit} className="flex flex-col gap-4">
        {!isManual && game && (
          <p className="text-[13px] text-text-lo">
            Jeu {SOURCE_LABELS[game.source]} — lancé via son launcher. L’exécutable est facultatif.
          </p>
        )}
        <div className="flex items-end gap-2.5">
          <Input
            className="flex-1"
            label="Exécutable"
            value={fields.executablePath}
            onChange={(e) => set('executablePath', e.target.value)}
            placeholder={isManual ? 'Choisissez le fichier du jeu…' : 'Facultatif'}
            spellCheck={false}
          />
          <Button variant="secondary" onClick={browse}>
            Parcourir…
          </Button>
        </div>
        <Input
          label="Titre"
          value={fields.title}
          onChange={(e) => set('title', e.target.value)}
          required
        />
        <Input
          label="Arguments de lancement"
          hint='Ex. -windowed --profile "Mon profil"'
          value={fields.launchArgs}
          onChange={(e) => set('launchArgs', e.target.value)}
          spellCheck={false}
        />
        <Input
          label="Dossier du jeu"
          hint="Par défaut, le dossier de l’exécutable."
          value={fields.installPath}
          onChange={(e) => set('installPath', e.target.value)}
          spellCheck={false}
        />
        {info.data?.platform === 'linux' && (
          <label className="flex items-center gap-2.5 text-sm text-text-mid">
            <input
              type="checkbox"
              checked={fields.useRunner}
              onChange={(e) => set('useRunner', e.target.checked)}
            />
            Lancer via Wine / Proton
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

export function GameFormDialog() {
  const form = useUiStore((s) => s.gameForm)
  const games = useGames()
  if (!form) return null
  const game = form.mode === 'edit' ? games.data?.find((g) => g.id === form.gameId) : undefined
  if (form.mode === 'edit' && !game) return null
  // Keyed so reopening for another game resets the fields.
  return <GameFormBody key={form.mode === 'edit' ? form.gameId : 'new'} form={form} game={game} />
}
