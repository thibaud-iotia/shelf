import { useMemo, useState } from 'react'
import { SOURCE_LABELS } from '@shared/domain'
import { pluralize } from '@shared/format'
import type { ImportCandidate } from '@shared/models'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { MatchPicker } from '@renderer/components/import/MatchPicker'
import { Input } from '@renderer/components/ui/Input'
import { useStartScan, useScanFolder } from '@renderer/lib/actions'
import { useApplyImport, useSettings } from '@renderer/lib/queries'
import {
  buildDecisions,
  defaultAction,
  effectiveCandidates,
  useImportStore
} from '@renderer/stores/import'
import { toast } from '@renderer/stores/toasts'
import { useUiStore } from '@renderer/stores/ui'

const fileName = (path: string | null) => path?.split(/[\\/]/).pop() ?? ''

function ReviewCard({ candidate }: { candidate: ImportCandidate }) {
  const choice = useImportStore((s) => s.choices[candidate.key])
  const choose = useImportStore((s) => s.choose)
  const settings = useSettings()
  const action = choice?.action ?? defaultAction(candidate)
  const duplicate = candidate.status === 'duplicate'

  if (choice?.confirmed) {
    return (
      <div
        data-testid="candidate-decided"
        className="flex items-center gap-3 px-5 py-3 rounded-md bg-ink-800 border border-ink-600 text-sm"
      >
        <b className="text-text-hi">{choice.title || candidate.title}</b>
        <span className="text-text-lo">
          {action === 'ignore' ? 'Ignoré' : action === 'merge' ? 'Sera fusionné' : 'Sera importé'}
        </span>
        <button
          type="button"
          onClick={() => choose(candidate.key, { confirmed: false })}
          className="ml-auto text-text-lo hover:text-text-hi cursor-pointer"
        >
          Annuler
        </button>
      </div>
    )
  }

  return (
    <article
      data-testid="candidate"
      aria-label={fileName(candidate.executablePath)}
      className="flex flex-col gap-3.5 p-5 rounded-lg bg-ink-800 border border-ink-600"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <b className="font-display font-bold text-base text-text-hi">
            {fileName(candidate.executablePath)}
          </b>
          <div className="font-mono text-xs text-text-lo break-all">{candidate.installPath}</div>
        </div>
        <span className="ml-auto">
          {duplicate ? (
            <Badge tone="amber">doublon {SOURCE_LABELS[candidate.duplicateOf!.source]}</Badge>
          ) : (
            <Badge tone="green">nouveau</Badge>
          )}
        </span>
      </div>

      {duplicate ? (
        <p className="text-sm text-text-mid">
          Déjà dans la bibliothèque ({SOURCE_LABELS[candidate.duplicateOf!.source]} :{' '}
          {candidate.duplicateOf!.title}). Fusionner ou ignorer ?
        </p>
      ) : (
        <>
          <Input
            label="Titre"
            size="sm"
            value={choice?.title ?? candidate.title}
            onChange={(e) => choose(candidate.key, { title: e.target.value })}
          />
          {settings.data?.igdbConfigured && (
            <MatchPicker
              title={choice?.title ?? candidate.title}
              selected={choice?.igdbId}
              onSelect={(igdbId, name) =>
                choose(candidate.key, {
                  igdbId,
                  ...(name && !choice?.title ? { title: name } : {})
                })
              }
            />
          )}
        </>
      )}

      <div className="flex gap-2">
        {duplicate ? (
          <Button
            variant="outline"
            onClick={() => choose(candidate.key, { action: 'merge', confirmed: true })}
          >
            Fusionner
          </Button>
        ) : (
          <Button onClick={() => choose(candidate.key, { action: 'import', confirmed: true })}>
            Importer
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => choose(candidate.key, { action: 'ignore', confirmed: true })}
        >
          Ignorer
        </Button>
      </div>
    </article>
  )
}

function ExcludedRow({ candidate }: { candidate: ImportCandidate }) {
  const restore = useImportStore((s) => s.restore)
  return (
    <div
      data-testid="candidate-excluded"
      className="flex items-center gap-3 px-5 py-3 rounded-md border-[1.5px] border-dashed border-ink-500 text-sm"
    >
      <b className="text-text-mid">{fileName(candidate.executablePath)}</b>
      <span className="text-text-lo">exclu : {candidate.excludedReason}</span>
      <span className="font-mono text-xs text-text-lo truncate">{candidate.installPath}</span>
      <button
        type="button"
        onClick={() => restore(candidate.key)}
        className="ml-auto text-red-300 font-semibold cursor-pointer hover:underline"
      >
        Restaurer
      </button>
    </div>
  )
}

export function ImportView() {
  const result = useImportStore((s) => s.result)
  const choices = useImportStore((s) => s.choices)
  const restored = useImportStore((s) => s.restored)
  const reset = useImportStore((s) => s.reset)
  const navigate = useUiStore((s) => s.navigate)
  const apply = useApplyImport()
  const scan = useStartScan()
  const scanFolder = useScanFolder()
  const [showAuto, setShowAuto] = useState(false)

  const candidates = useMemo(
    () => (result ? effectiveCandidates(result, restored) : []),
    [result, restored]
  )
  const review = candidates.filter((c) => c.needsReview && c.status !== 'excluded')
  const auto = candidates.filter((c) => !c.needsReview && c.status !== 'excluded')
  const excluded = candidates.filter((c) => c.status === 'excluded')
  const pending = review.filter((c) => !choices[c.key]?.confirmed)
  const decisions = buildDecisions(candidates, choices)
  const toImport = decisions.filter((d) => d.action !== 'ignore').length

  const importAll = async () => {
    try {
      const report = await apply.mutateAsync([decisions])
      toast.success(
        `${pluralize(report.imported, 'jeu importé', 'jeux importés')}` +
          (report.merged ? `, ${report.merged} fusionné(s)` : '') +
          (report.updated ? `, ${report.updated} mis à jour` : '')
      )
      reset()
      navigate({ name: 'library' })
    } catch {
      // Toast shown by the mutation.
    }
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col gap-5 px-7 py-6 max-w-[920px]">
      <header className="flex items-center gap-3">
        <h1 className="font-display font-bold text-[28px] tracking-[-.02em] text-text-hi">
          Jeux détectés
        </h1>
        <span className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={scanFolder.isPending}
            onClick={() => void scanFolder.pick()}
          >
            Scanner un dossier…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={scan.isPending}
            onClick={() => void scan.run()}
          >
            {scan.isPending ? 'Détection…' : 'Relancer la détection'}
          </Button>
        </span>
      </header>

      {!result ? (
        <div className="flex flex-col items-start gap-3 text-text-mid">
          <p>
            Shelf cherche les jeux installés par Steam, Epic, GOG et itch.io, et dans vos dossiers.
          </p>
          <Button onClick={() => void scan.run()} disabled={scan.isPending}>
            Lancer la détection
          </Button>
        </div>
      ) : (
        <>
          {result.errors.length > 0 && (
            <ul role="alert" className="flex flex-col gap-1 text-sm text-amber-300">
              {result.errors.map((e) => (
                <li key={e.message}>⚠ {e.message}</li>
              ))}
            </ul>
          )}

          <div className="flex items-baseline gap-3">
            <b data-testid="review-count" className="font-display font-bold text-lg text-text-hi">
              À vérifier ({pending.length})
            </b>
            <button
              type="button"
              data-testid="auto-count"
              onClick={() => setShowAuto((v) => !v)}
              className="text-green-300 text-sm cursor-pointer hover:underline"
            >
              {pluralize(
                auto.length,
                'correspondance automatique OK',
                'correspondances automatiques OK'
              )}
            </button>
          </div>

          {showAuto && (
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-text-mid">
              {auto.map((c) => (
                <li key={c.key} className="flex gap-2">
                  <span className="text-text-hi">{c.title}</span>
                  <span className="text-text-lo">
                    {SOURCE_LABELS[c.source]}
                    {c.status === 'update' ? ' · déjà présent' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-3">
            {review.map((c) => (
              <ReviewCard key={c.key} candidate={c} />
            ))}
            {review.length === 0 && (
              <p className="text-text-lo">Rien à vérifier : tout a été reconnu automatiquement.</p>
            )}
          </div>

          {excluded.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">
                EXCLUS ({excluded.length})
              </span>
              {excluded.map((c) => (
                <ExcludedRow key={c.key} candidate={c} />
              ))}
            </div>
          )}

          <div className="sticky bottom-0 -mx-7 px-7 py-4 flex justify-end bg-[linear-gradient(transparent,var(--surface-page)_35%)]">
            <Button size="lg" disabled={toImport === 0 || apply.isPending} onClick={importAll}>
              Tout importer ({toImport})
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
