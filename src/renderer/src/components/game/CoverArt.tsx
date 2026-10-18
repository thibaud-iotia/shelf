import { useState } from 'react'
import { placeholderGradient } from '@renderer/lib/artwork'

interface CoverArtProps {
  title: string
  url: string | null
  className?: string
}

/** Fills its (positioned) parent with the cover image, or the gradient placeholder. */
export function CoverArt({ title, url, className = '' }: CoverArtProps) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={`absolute inset-0 w-full h-full object-cover ${className}`}
      />
    )
  }
  return (
    <div
      aria-hidden
      className={`absolute inset-0 ${className}`}
      style={{ background: placeholderGradient(title) }}
    />
  )
}
