import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">{children}</span>
}

/** Loading / error / empty states shared by the tab panels. */
export function PanelState<T>({
  query,
  isEmpty,
  empty,
  children
}: {
  query: UseQueryResult<T>
  isEmpty: (data: T) => boolean
  empty: string
  children: (data: T) => ReactNode
}) {
  if (query.isPending) {
    return (
      <p data-testid="panel-loading" className="text-sm text-text-lo">
        Chargement…
      </p>
    )
  }
  if (query.isError) {
    return (
      <p data-testid="panel-error" role="alert" className="text-sm text-text-mid max-w-[640px]">
        {query.error.message}
      </p>
    )
  }
  if (isEmpty(query.data)) {
    return (
      <p data-testid="panel-empty" className="text-sm text-text-lo">
        {empty}
      </p>
    )
  }
  return <>{children(query.data)}</>
}

/** External link: opened in the system browser by the window's open handler. */
export function ExternalLink({
  href,
  className = '',
  children,
  ...rest
}: {
  href: string
  className?: string
  children: ReactNode
  'data-testid'?: string
  title?: string
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} {...rest}>
      {children}
    </a>
  )
}
