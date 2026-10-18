import { useEffect } from 'react'
import { FILTER_INPUT_ID } from '@renderer/components/library/FilterBar'
import { useUiStore } from '@renderer/stores/ui'

export const SHORTCUTS: [keys: string, action: string][] = [
  ['Ctrl/⌘ K', 'Palette de commandes'],
  ['/', 'Filtrer la vue affichée'],
  ['↑ ↓ ← →', 'Se déplacer dans la grille'],
  ['↵', 'Ouvrir la fiche du jeu sélectionné'],
  ['Ctrl/⌘ ↵', 'Lancer le jeu sélectionné'],
  ['Échap', 'Fermer / revenir à la bibliothèque'],
  ['Palette : ↵ / Tab', 'Lancer / ouvrir la fiche'],
  ['Clic droit', 'Menu : favori, tags, collections']
]

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** App-wide keyboard shortcuts. Mount once. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
        return
      }
      if (ui.paletteOpen || ui.gameForm || isTyping(e.target)) return
      if (e.key === '/') {
        const input = document.getElementById(FILTER_INPUT_ID)
        if (input) {
          e.preventDefault()
          input.focus()
        }
      } else if (e.key === 'Escape' && !ui.contextMenu && ui.route.name === 'game') {
        ui.back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
