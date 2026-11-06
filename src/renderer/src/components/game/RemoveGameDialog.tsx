import { useState, type ReactNode } from 'react'
import { SOURCE_LABELS } from '@shared/domain'
import type { Game } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import { Modal } from '@renderer/components/ui/Modal'
import { useDeleteGame, useGames, useUninstallGame, useUpdateGame } from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { useUiStore } from '@renderer/stores/ui'

function Option({
  title,
  children,
  action
}: {
  title: string
  children: ReactNode
  action: ReactNode
}) {
  return (
    <section className="flex items-start gap-4 p-4 rounded-md bg-ink-700/50 border border-ink-600">
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm text-text-hi">{title}</h3>
        <p className="mt-1 text-sm text-text-mid">{children}</p>
      </div>
      <div className="flex-none">{action}</div>
    </section>
  )
}

const noop = () => {}

function uninstallHint(game: Game): string {
  if (game.source === 'steam') {
    return 'Steam va s’ouvrir et vous demander de confirmer. Le jeu reste dans votre bibliothèque, prêt à être réinstallé.'
  }
  return 'Le désinstalleur du jeu va s’ouvrir (Windows peut demander une autorisation). Les fichiers du jeu sont supprimés par celui-ci.'
}

function RemoveGameBody({ game }: { game: Game }) {
  const close = useUiStore((s) => s.closeRemoveGame)
  const route = useUiStore((s) => s.route)
  const navigate = useUiStore((s) => s.navigate)
  const uninstall = useUninstallGame()
  const remove = useDeleteGame()
  const update = useUpdateGame()
  const [confirm, setConfirm] = useState(false)

  // A game listed by a connected account would come back at the next sync: hide it instead.
  const synced = game.lastSyncedAt !== null
  const installed = game.installState === 'installed'

  const leaveGamePage = () => {
    if (route.name === 'game' && route.id === game.id) navigate({ name: 'library' })
  }

  const doUninstall = () =>
    uninstall.mutate(game.id, {
      onSuccess: close
    })

  const done = (message: string) => () => {
    toast.info(message)
    leaveGamePage()
    close()
  }

  // mutateAsync, not mutate's callbacks: once removed, the game leaves the list and this
  // dialog unmounts before they would run. Errors are already shown by the mutation.
  const doHide = () =>
    update.mutateAsync([game.id, { hidden: true }]).then(done(`« ${game.title} » masqué`), noop)

  const doDelete = () =>
    remove.mutateAsync([game.id]).then(done(`« ${game.title} » retiré de la bibliothèque`), noop)

  return (
    <>
      {game.canUninstall && (
        <Option
          title="Désinstaller du disque"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={doUninstall}
              disabled={uninstall.isPending}
            >
              Désinstaller…
            </Button>
          }
        >
          {uninstallHint(game)}
        </Option>
      )}
      {installed && !game.canUninstall && game.source !== 'manual' && (
        <p className="text-sm text-text-mid">
          Pour libérer l’espace disque, désinstallez ce jeu depuis {SOURCE_LABELS[game.source]}.
        </p>
      )}

      {synced ? (
        <Option
          title="Masquer de la bibliothèque"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={doHide}
              disabled={update.isPending || game.hidden}
            >
              {game.hidden ? 'Déjà masqué' : 'Masquer'}
            </Button>
          }
        >
          Ce jeu vient de votre compte {SOURCE_LABELS[game.source]} : retiré, il reviendrait à la
          prochaine synchronisation. Il est donc masqué (Réglages › Afficher les jeux masqués pour
          le retrouver).
        </Option>
      ) : (
        <Option
          title="Retirer de la bibliothèque"
          action={
            confirm ? (
              <Button size="sm" variant="outline" onClick={doDelete} disabled={remove.isPending}>
                Confirmer le retrait
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                Retirer
              </Button>
            )
          }
        >
          Shelf oublie ce jeu (temps de jeu, sessions, tags, collections). Les fichiers sur le
          disque ne sont pas touchés.
        </Option>
      )}
    </>
  )
}

/** "Supprimer…": uninstall from the disk and / or remove from the library. */
export function RemoveGameDialog() {
  const id = useUiStore((s) => s.removingGameId)
  const close = useUiStore((s) => s.closeRemoveGame)
  const games = useGames()
  const game = games.data?.find((g) => g.id === id)
  if (id === null || !game) return null
  return (
    <Modal title={`Supprimer « ${game.title} »`} onClose={close} width={600}>
      <RemoveGameBody key={game.id} game={game} />
    </Modal>
  )
}
