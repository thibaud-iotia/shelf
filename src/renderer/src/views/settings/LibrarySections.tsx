import { useState } from 'react'
import { FolderList } from '@renderer/components/import/FolderList'
import { LauncherCards } from '@renderer/components/import/LauncherCards'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { Input } from '@renderer/components/ui/Input'
import { useStartScan } from '@renderer/lib/actions'
import { useLaunchers, useSettings, useUpdateSettings } from '@renderer/lib/queries'
import { Card, SectionTitle } from './common'

export function LaunchersSection() {
  const settings = useSettings()
  const launchers = useLaunchers()
  const update = useUpdateSettings()
  const scan = useStartScan()
  if (!settings.data) return null
  const enabled = settings.data.enabledLaunchers

  return (
    <>
      <SectionTitle hint="Les launchers inclus sont analysés à chaque détection. Leurs jeux sont lancés via le launcher lui-même.">
        Launchers
      </SectionTitle>
      {launchers.data && (
        <LauncherCards
          launchers={launchers.data}
          enabled={enabled}
          onToggle={(source) =>
            update.mutate({
              enabledLaunchers: enabled.includes(source)
                ? enabled.filter((s) => s !== source)
                : [...enabled, source]
            })
          }
        />
      )}
      <ul className="flex flex-col gap-1 text-xs font-mono text-text-lo">
        {launchers.data
          ?.filter((l) => l.location)
          .map((l) => (
            <li key={l.source}>
              {l.name} : {l.location}
            </li>
          ))}
      </ul>
      <div className="flex gap-2">
        <Button disabled={scan.isPending} onClick={() => void scan.run()}>
          {scan.isPending ? 'Détection…' : 'Relancer la détection'}
        </Button>
        <Button variant="ghost" onClick={() => void launchers.refetch()}>
          Actualiser
        </Button>
      </div>
    </>
  )
}

export function FoldersSection() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const [fragment, setFragment] = useState('')
  if (!settings.data) return null
  const { scanFolders, extraExclusions } = settings.data

  const addExclusion = () => {
    const value = fragment.trim()
    if (!value) return
    update.mutate({ extraExclusions: [...extraExclusions, value] })
    setFragment('')
  }

  return (
    <>
      <SectionTitle hint="Pour les jeux sans launcher : un jeu par sous-dossier, l’exécutable principal est choisi automatiquement.">
        Dossiers et exclusions
      </SectionTitle>
      <Card title="Dossiers scannés">
        <FolderList
          folders={scanFolders}
          onChange={(folders) => update.mutate({ scanFolders: folders })}
        />
      </Card>
      <Card title="Exclusions">
        <p className="text-sm text-text-mid">
          Déjà exclus : désinstalleurs, installateurs, redistribuables (DirectX, VC++…), crash
          reporters et outils. Ajoutez des fragments de nom de fichier à ignorer.
        </p>
        <div className="flex flex-wrap gap-2" data-testid="exclusions">
          {extraExclusions.map((x) => (
            <Chip
              key={x}
              variant="tag"
              aria-label={`Retirer l’exclusion ${x}`}
              onClick={() =>
                update.mutate({ extraExclusions: extraExclusions.filter((e) => e !== x) })
              }
            >
              {x} ✕
            </Chip>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addExclusion()
          }}
        >
          <Input
            className="flex-1"
            label="Nouvelle exclusion"
            placeholder="ex. benchmark"
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            Ajouter
          </Button>
        </form>
      </Card>
    </>
  )
}
