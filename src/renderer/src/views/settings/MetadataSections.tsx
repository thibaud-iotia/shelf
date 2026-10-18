import { useState } from 'react'
import { formatBytes, pluralize } from '@shared/format'
import { MetadataKeysForm } from '@renderer/components/settings/MetadataKeysForm'
import { Button } from '@renderer/components/ui/Button'
import { useCacheInfo, useClearCache } from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { Card, SectionTitle } from './common'

function CacheLine() {
  const info = useCacheInfo()
  const clear = useClearCache()
  return (
    <span data-testid="cache-size">
      Cache images : {info.data ? formatBytes(info.data.bytes) : '…'} ·{' '}
      <button
        type="button"
        disabled={clear.isPending}
        onClick={() =>
          clear.mutate(undefined, { onSuccess: () => toast.info('Cache des images vidé') })
        }
        className="text-red-300 hover:underline cursor-pointer"
      >
        Vider
      </button>
    </span>
  )
}

// Mockup 08 — "Métadonnées et images".
export function MetadataSection() {
  return (
    <>
      <SectionTitle>Métadonnées et images</SectionTitle>
      <MetadataKeysForm />
      <div className="flex items-center gap-4 text-[13px] text-text-lo">
        <span>Clés chiffrées par le système, jamais affichées en clair</span>
        <span className="ml-auto">
          <CacheLine />
        </span>
      </div>
    </>
  )
}

export function CacheSection() {
  const info = useCacheInfo()
  const clear = useClearCache()
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <SectionTitle hint="Jaquettes, héros, logos et captures téléchargés, stockés dans le dossier de données de Shelf.">
        Cache
      </SectionTitle>
      <Card title="Images en cache">
        <p className="text-text-hi font-display text-3xl font-bold">
          {info.data ? formatBytes(info.data.bytes) : '…'}
        </p>
        <p className="text-sm text-text-lo">
          {info.data ? pluralize(info.data.files, 'fichier', 'fichiers') : ''}
        </p>
        <div>
          {confirm ? (
            <Button
              variant="outline"
              onClick={() => {
                clear.mutate()
                setConfirm(false)
              }}
            >
              Confirmer : vider le cache
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Vider le cache
            </Button>
          )}
        </div>
        <p className="text-xs text-text-lo">
          Les descriptions et genres sont conservés ; les images seront retéléchargées au prochain «
          Actualiser les visuels ».
        </p>
      </Card>
    </>
  )
}
