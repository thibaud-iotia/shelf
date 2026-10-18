import { useState, type ReactNode } from 'react'
import type { GameSourceId } from '@shared/domain'
import { FolderList } from '@renderer/components/import/FolderList'
import { LauncherCards } from '@renderer/components/import/LauncherCards'
import { MetadataKeysForm } from '@renderer/components/settings/MetadataKeysForm'
import { Button } from '@renderer/components/ui/Button'
import { useStartScan } from '@renderer/lib/actions'
import { call } from '@renderer/lib/ipc'
import { useLaunchers, useSettings, useUpdateSettings } from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { useUiStore } from '@renderer/stores/ui'

const STEPS = ['Launchers', 'Métadonnées', 'Dossiers'] as const

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Étapes">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-3">
          {index > 0 && <span className="w-10 h-px bg-ink-500" />}
          <span
            aria-current={index === step ? 'step' : undefined}
            className={`flex items-center gap-2 text-sm ${index === step ? 'text-text-hi font-semibold' : 'text-text-lo'}`}
          >
            <i
              className={`not-italic w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                index <= step ? 'bg-grad-brand text-white' : 'bg-ink-700 text-text-lo'
              }`}
            >
              {index + 1}
            </i>
            {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

function StepTitle({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-display font-bold text-[34px] tracking-[-.02em] text-text-hi">{title}</h1>
      <p className="text-text-mid">{subtitle}</p>
    </div>
  )
}

function MetadataStep() {
  return (
    <>
      <StepTitle
        title="Métadonnées et jaquettes"
        subtitle="Facultatif : avec IGDB (descriptions, genres, dates) et SteamGridDB (jaquettes, héros, logos), Shelf habille la bibliothèque automatiquement."
      />
      <MetadataKeysForm compact />
    </>
  )
}

// Mockup 05 — onboarding wizard, step 1/3.
export function OnboardingView() {
  const [step, setStep] = useState(0)
  const settings = useSettings()
  const launchers = useLaunchers()
  const update = useUpdateSettings()
  const navigate = useUiStore((s) => s.navigate)
  const scan = useStartScan()

  if (!settings.data) return null
  const { enabledLaunchers, scanFolders } = settings.data

  const toggle = (source: GameSourceId) =>
    update.mutate({
      enabledLaunchers: enabledLaunchers.includes(source)
        ? enabledLaunchers.filter((s) => s !== source)
        : [...enabledLaunchers, source]
    })

  const addManualFolder = async () => {
    try {
      const folder = await call('import:pickFolder')
      if (!folder) return
      update.mutate({ scanFolders: [...new Set([...scanFolders, folder])] })
      toast.success('Dossier ajouté : il sera scanné à la fin de l’assistant.')
    } catch (e) {
      toast.error(e)
    }
  }

  const finish = async (runScan: boolean) => {
    await update.mutateAsync({ onboardingDone: true })
    if (runScan) await scan.run()
    else navigate({ name: 'library' })
  }

  return (
    <section className="flex-1 min-h-[calc(100%+var(--title-bar))] -mt-[var(--title-bar)] flex justify-center bg-grad-hero px-10 pt-[calc(var(--title-bar)+40px)] pb-10">
      <div className="w-full max-w-[860px] flex flex-col gap-8">
        <div className="flex items-center">
          <Stepper step={step} />
          <button
            type="button"
            onClick={() => void finish(false)}
            className="ml-auto text-sm text-text-lo hover:text-text-hi cursor-pointer"
          >
            Passer l’introduction
          </button>
        </div>

        {step === 0 && (
          <>
            <StepTitle
              title="On a trouvé vos launchers"
              subtitle="Détection automatique — décochez ce que vous ne voulez pas."
            />
            {launchers.data ? (
              <LauncherCards
                launchers={launchers.data}
                enabled={enabledLaunchers}
                onToggle={toggle}
              />
            ) : (
              <p className="text-text-lo">Recherche des launchers…</p>
            )}
            <button
              type="button"
              onClick={addManualFolder}
              className="self-center text-sm text-red-300 hover:underline cursor-pointer"
            >
              Chemin introuvable ? Indiquer le dossier manuellement
            </button>
          </>
        )}

        {step === 1 && <MetadataStep />}

        {step === 2 && (
          <>
            <StepTitle
              title="Vos dossiers de jeux"
              subtitle="Jeux sans launcher (itch, DRM-free, émulateurs…) : Shelf y cherche un exécutable par sous-dossier."
            />
            <FolderList
              folders={scanFolders}
              onChange={(folders) => update.mutate({ scanFolders: folders })}
            />
          </>
        )}

        <div className="mt-auto flex items-center gap-4">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              ← Retour
            </Button>
          )}
          <span className="ml-auto" />
          <button
            type="button"
            onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : void finish(false))}
            className="text-text-lo hover:text-text-hi cursor-pointer"
          >
            Passer
          </button>
          {step < STEPS.length - 1 ? (
            <Button size="lg" onClick={() => setStep(step + 1)}>
              Suivant →
            </Button>
          ) : (
            <Button size="lg" disabled={scan.isPending} onClick={() => void finish(true)}>
              {scan.isPending ? 'Détection…' : 'Lancer la détection'}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
