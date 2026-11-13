import { SOURCE_LABELS } from '@shared/domain'
import type { InstallSource } from '@shared/models'
import { Button } from '@renderer/components/ui/Button'
import {
  useAppInfo,
  usePickInstallFolder,
  usePickRunner,
  useSettings,
  useUpdateSettings
} from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { Card, SectionTitle, Toggle } from './common'

/** Default install location of a launcher: a folder picked, or Shelf's own choice. */
function DefaultLocation({
  source,
  path,
  auto,
  disabled
}: {
  source: InstallSource
  path: string | null
  auto: string
  disabled: boolean
}) {
  const settings = useSettings()
  const update = useUpdateSettings()
  const pick = usePickInstallFolder()
  const paths = settings.data?.installPaths ?? { steam: null, epic: null }
  const save = (next: string | null) =>
    update.mutate({ installPaths: { ...paths, [source]: next } })

  const change = () =>
    pick.mutate(source, {
      onSuccess: (picked) => {
        if (!picked) return
        if (picked.notice) toast.info(picked.notice)
        save(picked.location.path)
      }
    })

  return (
    <div
      data-testid={`install-path-${source}`}
      className={`flex items-center gap-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm text-text-hi">{SOURCE_LABELS[source]}</span>
        <span className={`text-xs break-all ${path ? 'font-mono text-text-mid' : 'text-text-lo'}`}>
          {path ?? auto}
        </span>
      </span>
      <Button variant="secondary" size="sm" disabled={disabled || pick.isPending} onClick={change}>
        Changer…
      </Button>
      {path && (
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => save(null)}>
          Automatique
        </Button>
      )}
    </div>
  )
}

export function SystemSection() {
  const settings = useSettings()
  const info = useAppInfo()
  const update = useUpdateSettings()
  const pickRunner = usePickRunner()
  if (!settings.data) return null
  const {
    launchAtStartup,
    minimizeToTray,
    runnerPath,
    platform,
    backgroundInstall,
    askInstallLocation,
    installPaths
  } = settings.data

  return (
    <>
      <SectionTitle>Système</SectionTitle>
      <Card title="Démarrage et barre système">
        <Toggle
          label="Lancer Shelf à l’ouverture de session"
          hint="Démarre réduit dans la barre système. Effectif dans la version installée."
          checked={launchAtStartup}
          onChange={(value) => update.mutate({ launchAtStartup: value })}
        />
        <Toggle
          label="Fermer la fenêtre réduit Shelf dans la barre système"
          hint="L’icône de la barre système donne accès aux jeux récents ; « Quitter Shelf » ferme vraiment."
          checked={minimizeToTray}
          onChange={(value) => update.mutate({ minimizeToTray: value })}
        />
      </Card>
      <Card title="Installation des jeux">
        <Toggle
          label="Installer en arrière-plan, sans ouvrir le launcher"
          hint="Steam : Shelf ajoute le jeu à la file de Steam puis le redémarre réduit dans la barre système (jamais pendant une partie). Epic : via Legendary ou Heroic, si vous y êtes connecté. Désactivé : la page d’installation du launcher s’ouvre."
          checked={backgroundInstall}
          onChange={(value) => update.mutate({ backgroundInstall: value })}
        />
        <Toggle
          label="Demander l’emplacement à chaque installation"
          hint="Bibliothèque Steam ou dossier Epic, avec l’espace libre. Désactivé : l’emplacement par défaut ci-dessous."
          checked={askInstallLocation}
          disabled={!backgroundInstall}
          onChange={(value) => update.mutate({ askInstallLocation: value })}
        />
        <DefaultLocation
          source="steam"
          path={installPaths.steam}
          auto="Automatique : la bibliothèque Steam avec le plus d’espace libre"
          disabled={!backgroundInstall}
        />
        <DefaultLocation
          source="epic"
          path={installPaths.epic}
          auto="Automatique : le dossier par défaut de Heroic ou Legendary"
          disabled={!backgroundInstall}
        />
      </Card>
      <Card title="Wine / Proton">
        <p className="text-sm text-text-mid">
          {platform === 'linux'
            ? 'Les jeux .exe ajoutés à la main sont lancés via ce runner (Wine ou le script proton d’une version de Proton).'
            : 'Linux uniquement : lancer des jeux Windows (.exe) via Wine ou Proton.'}
        </p>
        <span data-testid="runner-path" className="font-mono text-xs text-text-hi break-all">
          {runnerPath ?? 'Aucun runner configuré'}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={platform !== 'linux' && !info.data}
            onClick={() => pickRunner.mutate()}
          >
            Choisir…
          </Button>
          {runnerPath && (
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ runnerPath: null })}>
              Retirer
            </Button>
          )}
        </div>
      </Card>
    </>
  )
}
