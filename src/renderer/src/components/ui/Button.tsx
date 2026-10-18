import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Port of the Certflix DS Button (components/forms/Button.jsx) to Tailwind classes.

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg'

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-[var(--control-sm)] px-3.5 gap-1.5 text-[length:var(--fs-body-sm)] rounded-sm',
  md: 'h-[var(--control-md)] px-5 gap-2 text-[length:var(--fs-body-sm)] rounded-md',
  lg: 'h-[var(--control-lg)] px-7 gap-2.5 text-[length:var(--fs-body)] rounded-md'
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-grad-brand text-white border-transparent shadow-glow-brand hover:brightness-108',
  accent:
    'bg-[image:var(--grad-accent)] text-[#04150E] border-transparent shadow-glow-accent hover:brightness-108',
  secondary: 'bg-card-hi text-heading border-line hover:brightness-115',
  ghost: 'bg-transparent text-heading border-transparent hover:brightness-115 hover:bg-card-hi',
  outline: 'bg-transparent text-brand border-brand hover:brightness-108'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  leftIcon,
  rightIcon,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        block ? 'flex w-full' : 'inline-flex',
        'items-center justify-center border font-body font-semibold leading-none tracking-[-0.005em] whitespace-nowrap',
        'cursor-pointer transition-[transform,filter,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        'active:scale-97 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        sizeClasses[size],
        variantClasses[variant],
        className
      ].join(' ')}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}
