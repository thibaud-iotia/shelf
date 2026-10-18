import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

// Port of the Certflix DS Input (components/forms/Input.jsx).

type InputSize = 'sm' | 'md' | 'lg'

const heights: Record<InputSize, string> = {
  sm: 'h-[var(--control-sm)]',
  md: 'h-[var(--control-md)]',
  lg: 'h-[var(--control-lg)]'
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: string
  error?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  size?: InputSize
}

export function Input({
  label,
  hint,
  error,
  leftIcon,
  rightIcon,
  size = 'md',
  id,
  className = '',
  disabled,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const border = error
    ? 'border-[var(--danger)]'
    : 'border-line focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--focus-ring)]'

  return (
    <div className={`flex flex-col gap-1.5 font-body ${className}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-[length:var(--fs-body-sm)] font-semibold text-heading"
        >
          {label}
        </label>
      )}
      <div
        className={`flex items-center gap-2 px-3.5 bg-inset rounded-md border transition-[border-color,box-shadow] duration-[var(--dur-fast)] ${heights[size]} ${border} ${disabled ? 'opacity-50' : ''}`}
      >
        {leftIcon && <span className="flex text-muted">{leftIcon}</span>}
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-heading text-[length:var(--fs-body-sm)] placeholder:text-muted"
          {...rest}
        />
        {rightIcon && <span className="flex text-muted">{rightIcon}</span>}
      </div>
      {(hint || error) && (
        <span
          className={`text-[length:var(--fs-caption)] ${error ? 'text-[var(--danger)]' : 'text-muted'}`}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  )
}
