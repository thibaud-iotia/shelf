import { Button } from '@renderer/components/ui/Button'
import { useAppInfo, usePickRunner, useSettings, useUpdateSettings } from '@renderer/lib/queries'
import { Card, SectionTitle, Toggle } from './common'

export function SystemSection() {
  const settings = useSettings()
  const info = useAppInfo()
  const update = useUpdateSettings()
  const pickRunner = usePickRunner()
  if (!settings.data) return null
  const { launchAtStartup, minimizeToTray, runnerPath, platform } = settings.data

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
