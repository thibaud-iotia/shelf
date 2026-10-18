import { useToasts } from '@renderer/stores/toasts'

const kindClasses = {
  info: 'border-ink-500',
  success: 'border-green-300/60',
  error: 'border-red-300/70'
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[360px] pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          data-testid={`toast-${t.kind}`}
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-md bg-ink-800 border shadow-[0_12px_40px_rgba(0,0,0,.5)] text-sm text-text-hi ${kindClasses[t.kind]}`}
        >
          <span className="flex-1 select-text">{t.message}</span>
          <button
            type="button"
            aria-label="Fermer la notification"
            onClick={() => dismiss(t.id)}
            className="text-text-lo hover:text-text-hi cursor-pointer"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
