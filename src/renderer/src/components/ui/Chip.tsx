import type { ButtonHTMLAttributes } from 'react'

// Pills from the mockups: filter chips (01), genre chips (03), tag chips (03, 06, 07).

type ChipVariant = 'filter' | 'outline' | 'tag' | 'dashed'

const variants: Record<ChipVariant, (active: boolean) => string> = {
  filter: (active) =>
    active
      ? 'px-4 py-1.5 bg-[#F4F4F8] text-[#14141C] border border-transparent'
      : 'px-4 py-1.5 border border-ink-500 text-text-mid hover:border-ink-400',
  outline: () => 'px-3.5 py-[5px] border border-ink-500 text-text-mid font-medium',
  tag: (active) =>
    active
      ? 'px-3.5 py-[5px] bg-brand text-white'
      : 'px-3.5 py-[5px] bg-brand-subtle text-red-200 hover:brightness-125',
  dashed: () =>
    'px-3.5 py-[5px] border border-dashed border-ink-400 text-text-lo hover:text-text-mid'
}

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ChipVariant
  active?: boolean
}

export function Chip({
  variant = 'filter',
  active = false,
  className = '',
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={variant === 'filter' || variant === 'tag' ? active : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${variants[variant](active)} ${className}`}
      {...rest}
    />
  )
}
