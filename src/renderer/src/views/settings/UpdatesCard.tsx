import type { AppUpdateState } from '@shared/models'
import { formatDay } from '@shared/format'
import { Button } from '@renderer/components/ui/Button'
import {
  useCheckForUpdates,
  useInstallUpdate,
  useOpenUpdateDownload,
  useSettings,
  useUpdaterState,
  useUpdateSettings
} from '@renderer/lib/queries'
import { Card, StatusPill, Toggle } from './common'

function checkedAt(time: number | null): string {
  if (time === null) return ''
  const hour = new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return ` (vérifié ${formatDay(time).toLowerCase()} à ${hour})`
}

function statusText(state: AppUpdateState): string {
  switch (state.phase) {
    case 'checking':
      return 'Recherche d’une nouvelle version…'
    case 'up-to-date':
      return `Shelf est à jour${checkedAt(state.checkedAt)}.`
    case 'available':
      return `Shelf ${state.version} est disponible.`
    case 'downloading':
      return `Téléchargement de Shelf ${state.version}… ${state.percent ?? 0} %`
    case 'ready':
      return `Shelf ${state.version} est prête : redémarrez pour l’installer (ou elle s’installera en quittant Shelf).`
    case 'error':
      return state.error ?? 'La vérification a échoué.'
    default:
      return 'Aucune vérification depuis le démarrage.'
  }
}

const MODE_HINT: Record<AppUpdateState['mode'], string> = {
  auto: 'Les nouvelles versions sont téléchargées en arrière-plan puis installées par-dessus la version actuelle au redémarrage : rien à désinstaller, vos jeux et réglages sont conservés.',
  manual:
    'Shelf signale les nouvelles versions et ouvre le fichier à télécharger : installez-le par-dessus (macOS : remplacez l’app dans Applications). Rien à désinstaller, vos données sont conservées.',
  disabled: 'Version de développement : les mises à jour sont désactivées.'
}

export function UpdatesCard() {
  const { data: state } = useUpdaterState()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const check = useCheckForUpdates()
  const install = useInstallUpdate()
  const openDownload = useOpenUpdateDownload()
  if (!state || !settings.data) return null
  const disabled = state.mode === 'disabled'
  const busy = state.phase === 'checking' || state.phase === 'downloading' || check.isPending

  return (
    <Card
      title="Mises à jour"
      testId="updates-card"
      status={
        <StatusPill ok={state.phase === 'up-to-date'}>Version {state.currentVersion}</StatusPill>
      }
    >
      <p className="text-sm text-text-lo">{MODE_HINT[state.mode]}</p>
      {state.lastInstall?.outcome === 'failed' && (
        <div className="flex flex-wrap items-center gap-3">
          <p data-testid="update-blocked" className="text-sm text-red-300">
            La mise à jour vers Shelf {state.lastInstall.version} ne s’est pas installée (un
            antivirus a peut-être bloqué l’installeur).
          </p>
          <Button size="sm" variant="secondary" onClick={() => openDownload.mutate()}>
            Télécharger l’installeur
          </Button>
        </div>
      )}
      {!disabled && (
        <>
          <p
            role="status"
            data-testid="update-status"
            className={`text-sm ${state.phase === 'error' ? 'text-red-300' : 'text-text-hi'}`}
          >
            {statusText(state)}
          </p>
          <div className="flex flex-wrap gap-2">
            {state.phase === 'ready' ? (
              <Button size="sm" disabled={install.isPending} onClick={() => install.mutate()}>
                Redémarrer et installer
              </Button>
            ) : state.phase === 'available' ? (
              <Button size="sm" onClick={() => openDownload.mutate()}>
                Télécharger Shelf {state.version}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => check.mutate()}>
                Rechercher des mises à jour
              </Button>
            )}
            {state.releaseUrl && (
              <a
                href={state.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="self-center text-sm text-brand hover:underline"
              >
                Nouveautés de la version {state.version}
              </a>
            )}
          </div>
          <Toggle
            label="Rechercher automatiquement les mises à jour"
            hint="Au démarrage puis toutes les 4 heures, depuis les versions publiées sur GitHub."
            checked={settings.data.autoUpdateCheck}
            onChange={(value) => updateSettings.mutate({ autoUpdateCheck: value })}
          />
        </>
      )}
    </Card>
  )
}
