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
  ['Bouton « précédent » de la souris', 'Quitter la fiche d’un jeu'],
  ['Palette : ↵ / Tab', 'Lancer / ouvrir la fiche'],
  ['Clic droit', 'Menu : favori, tags, collections']
]

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** App-wide keyboard shortcuts. Mount once. */

/** Pages left with Escape or the mouse "back" button: game page, store page of a game. */
const isDetail = (name: string) => name === 'game' || name === 'storeGame'

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
      } else if (e.key === 'Escape' && !ui.contextMenu && isDetail(ui.route.name)) {
        ui.back()
      }
    }
    // Mouse "back" button (button 3) leaves a game page, like Escape.
    const onMouse = (e: MouseEvent) => {
      const ui = useUiStore.getState()
      if (e.button !== 3 || !isDetail(ui.route.name) || ui.paletteOpen || ui.gameForm) return
      e.preventDefault()
      ui.back()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])
}
