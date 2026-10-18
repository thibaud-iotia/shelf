import type { ReactNode } from 'react'

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-display font-bold text-[22px] tracking-[-.01em] text-text-hi">
        {children}
      </h2>
      {hint && <p className="text-sm text-text-lo">{hint}</p>}
    </div>
  )
}

export function Card({
  title,
  status,
  children,
  testId
}: {
  title: ReactNode
  status?: ReactNode
  children: ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-4 p-6 rounded-lg bg-ink-800 border border-ink-600"
    >
      <div className="flex items-center gap-3">
        <b className="font-display font-bold text-lg text-text-hi">{title}</b>
        {status && <span className="ml-auto">{status}</span>}
      </div>
      {children}
    </div>
  )
}

export function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`px-3 py-1 rounded-full text-[13px] font-semibold ${
        ok ? 'bg-accent-subtle text-green-300' : 'bg-ink-700 text-text-lo'
      }`}
    >
      {children}
    </span>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="mt-0.5 w-9 h-5 flex-none rounded-full bg-ink-600 relative transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-brand after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-text-hi">{label}</span>
        {hint && <span className="text-xs text-text-lo">{hint}</span>}
      </span>
    </label>
  )
}

export function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">{label}</span>
      <span data-testid={testId} className="font-mono text-xs text-text-hi break-all select-text">
        {value}
      </span>
    </div>
  )
}
