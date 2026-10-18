import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

/** Centered dialog over a blurred backdrop. Escape and backdrop click close it. */
export function Modal({ title, onClose, children, footer, width = 560 }: ModalProps) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,8,12,.6)] backdrop-blur-[6px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        className="max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)] flex flex-col rounded-lg bg-ink-800 border border-ink-600 shadow-[0_24px_80px_rgba(0,0,0,.6)]"
      >
        <header className="flex items-center px-6 pt-5 pb-3">
          <h2 id={titleId} className="font-display font-bold text-xl text-text-hi">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="ml-auto w-8 h-8 rounded-sm text-text-lo hover:bg-ink-700 hover:text-text-hi cursor-pointer"
          >
            ✕
          </button>
        </header>
        <div className="px-6 pb-5 overflow-auto flex flex-col gap-4">{children}</div>
        {footer && (
          <footer className="flex items-center gap-2.5 px-6 py-4 border-t border-ink-600">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
