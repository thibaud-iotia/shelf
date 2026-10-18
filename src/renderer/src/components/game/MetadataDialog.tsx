import { useState } from 'react'
import type { Game } from '@shared/models'
import { MatchPicker } from '@renderer/components/import/MatchPicker'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { Modal } from '@renderer/components/ui/Modal'
import { useApplyMetadata } from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'

/** Search IGDB for a game and apply the chosen entry (text + artwork). */
export function MetadataDialog({ game, onClose }: { game: Game; onClose: () => void }) {
  const [query, setQuery] = useState(game.title)
  const [selected, setSelected] = useState<number | null | undefined>(game.igdbId ?? undefined)
  const apply = useApplyMetadata()

  const submit = async () => {
    try {
      await apply.mutateAsync([game.id, selected ?? null])
      toast.success(`${game.title} : métadonnées mises à jour`)
      onClose()
    } catch {
      // Toast shown by the mutation.
    }
  }

  return (
    <Modal
      title="Métadonnées"
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="text-xs text-text-lo">
            Visuels SteamGridDB si configuré, sinon IGDB.
          </span>
          <span className="ml-auto" />
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={apply.isPending} onClick={submit}>
            {apply.isPending ? 'Téléchargement…' : 'Appliquer'}
          </Button>
        </>
      }
    >
      <Input label="Rechercher sur IGDB" value={query} onChange={(e) => setQuery(e.target.value)} />
      <MatchPicker title={query} selected={selected} onSelect={(id) => setSelected(id)} />
    </Modal>
  )
}
