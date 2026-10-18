import type { CoverSize } from '@shared/models'
import { Chip } from '@renderer/components/ui/Chip'
import { SHORTCUTS } from '@renderer/lib/shortcuts'
import { useSettings, useUpdateSettings } from '@renderer/lib/queries'
import { Card, SectionTitle, Toggle } from './common'

const SIZES: [CoverSize, string][] = [
  ['sm', 'Petites'],
  ['md', 'Moyennes'],
  ['lg', 'Grandes']
]

export function AppearanceSection() {
  const settings = useSettings()
  const update = useUpdateSettings()
  if (!settings.data) return null
  return (
    <>
      <SectionTitle hint="Thème sombre Certflix.">Apparence</SectionTitle>
      <Card title="Jaquettes">
        <div role="radiogroup" aria-label="Taille des jaquettes" className="flex gap-2">
          {SIZES.map(([value, label]) => (
            <Chip
              key={value}
              role="radio"
              aria-checked={settings.data.coverSize === value}
              active={settings.data.coverSize === value}
              onClick={() => update.mutate({ coverSize: value })}
            >
              {label}
            </Chip>
          ))}
        </div>
        <Toggle
          label="Afficher les jeux masqués"
          hint="Ils restent grisés dans la grille ; « Afficher » dans le menu contextuel les rétablit."
          checked={settings.data.showHidden}
          onChange={(value) => update.mutate({ showHidden: value })}
        />
      </Card>
    </>
  )
}

export function ShortcutsSection() {
  return (
    <>
      <SectionTitle hint="La navigation au clavier couvre toute l’application.">
        Raccourcis
      </SectionTitle>
      <Card title="Clavier">
        <dl className="grid grid-cols-[200px_1fr] gap-y-2.5">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="font-mono text-xs px-2 py-1 rounded-xs bg-ink-700 text-text-hi">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-sm text-text-mid">{action}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  )
}
