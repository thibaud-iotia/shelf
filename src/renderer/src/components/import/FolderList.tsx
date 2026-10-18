import { Button } from '@renderer/components/ui/Button'
import { call } from '@renderer/lib/ipc'
import { toast } from '@renderer/stores/toasts'

interface FolderListProps {
  folders: string[]
  onChange: (folders: string[]) => void
}

/** Scan folders: list with removal + native folder picker. */
export function FolderList({ folders, onChange }: FolderListProps) {
  const add = async () => {
    try {
      const folder = await call('import:pickFolder')
      if (folder && !folders.includes(folder)) onChange([...folders, folder])
    } catch (e) {
      toast.error(e)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <ul data-testid="scan-folders" className="flex flex-col gap-2">
        {folders.map((folder) => (
          <li
            key={folder}
            className="flex items-center gap-3 px-4 py-2.5 rounded-md bg-ink-800 border border-ink-600"
          >
            <span className="font-mono text-xs text-text-hi break-all select-text">{folder}</span>
            <button
              type="button"
              aria-label={`Retirer ${folder}`}
              onClick={() => onChange(folders.filter((f) => f !== folder))}
              className="ml-auto text-text-lo hover:text-red-300 cursor-pointer"
            >
              ✕
            </button>
          </li>
        ))}
        {folders.length === 0 && (
          <li className="text-sm text-text-lo">Aucun dossier pour l’instant.</li>
        )}
      </ul>
      <div>
        <Button variant="secondary" size="sm" onClick={add}>
          + Ajouter un dossier…
        </Button>
      </div>
    </div>
  )
}
