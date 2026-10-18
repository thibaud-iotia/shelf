import type { ReactNode } from 'react'

type BadgeTone = 'green' | 'amber' | 'neutral' | 'brand'

const tones: Record<BadgeTone, string> = {
  green: 'bg-accent-subtle text-green-300',
  amber: 'bg-warning-subtle text-amber-300',
  neutral: 'bg-ink-700 text-text-mid',
  brand: 'bg-brand-subtle text-red-200'
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
