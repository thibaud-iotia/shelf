import { useEffect, useState } from 'react'
import type { GameVideo, StoreScreenshot } from '@shared/models'
import { Player } from './VideosPanel'

type Item = { kind: 'video'; video: GameVideo } | { kind: 'image'; shot: StoreScreenshot }

const itemKey = (item: Item) => (item.kind === 'video' ? item.video.id : item.shot.fullUrl)

/** Full-screen screenshot viewer: ← / → to browse, Échap to close. */
function Lightbox({
  shots,
  index,
  onIndex,
  onClose
}: {
  shots: StoreScreenshot[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const count = shots.length
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') onIndex((index + 1) % count)
      else if (event.key === 'ArrowLeft') onIndex((index - 1 + count) % count)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, count, onIndex, onClose])

  const nav =
    'absolute top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 text-white text-2xl hover:bg-black/80 cursor-pointer'
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Capture ${index + 1} sur ${count}`}
      data-testid="lightbox"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-10"
    >
      <img
        src={shots[index]!.fullUrl}
        alt=""
        onClick={(event) => event.stopPropagation()}
        className="max-w-full max-h-full rounded-lg object-contain"
      />
      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Capture précédente"
            className={`${nav} left-6`}
            onClick={(event) => {
              event.stopPropagation()
              onIndex((index - 1 + count) % count)
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Capture suivante"
            className={`${nav} right-6`}
            onClick={(event) => {
              event.stopPropagation()
              onIndex((index + 1) % count)
            }}
          >
            ›
          </button>
        </>
      )}
      <span className="absolute bottom-4 text-sm text-white/70">
        {index + 1} / {count}
      </span>
    </div>
  )
}

/**
 * Steam-like media strip of the overview: the first trailer, then the screenshots.
 * A screenshot opens full screen on click.
 */
export function MediaGallery({
  video,
  shots
}: {
  video: GameVideo | undefined
  shots: StoreScreenshot[]
}) {
  const items: Item[] = [
    ...(video ? [{ kind: 'video' as const, video }] : []),
    ...shots.map((shot) => ({ kind: 'image' as const, shot }))
  ]
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined)
  const [zoomed, setZoomed] = useState<number | null>(null)
  const selected = items.find((item) => itemKey(item) === selectedKey) ?? items[0]
  if (!selected) return null

  return (
    <div data-testid="media-gallery" className="flex flex-col gap-2.5 max-w-[860px]">
      {selected.kind === 'video' ? (
        <Player key={selected.video.id} video={selected.video} />
      ) : (
        <button
          type="button"
          aria-label="Agrandir la capture"
          onClick={() => setZoomed(shots.indexOf(selected.shot))}
          className="block w-full aspect-video rounded-lg overflow-hidden bg-ink-800 cursor-zoom-in"
        >
          <img src={selected.shot.fullUrl} alt="" className="w-full h-full object-cover" />
        </button>
      )}
      {items.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {items.map((item) => {
            const active = item === selected
            const thumb = item.kind === 'video' ? item.video.posterUrl : item.shot.thumbUrl
            return (
              <li key={itemKey(item)} className="flex-none">
                <button
                  type="button"
                  aria-label={
                    item.kind === 'video'
                      ? `Vidéo : ${item.video.title}`
                      : `Capture ${shots.indexOf(item.shot) + 1}`
                  }
                  aria-pressed={active}
                  onClick={() => setSelectedKey(itemKey(item))}
                  className={`relative block w-[132px] aspect-video rounded-md overflow-hidden bg-ink-800 border-2 cursor-pointer ${
                    active ? 'border-brand' : 'border-transparent hover:border-ink-400'
                  }`}
                >
                  {thumb && (
                    <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
                  )}
                  {item.kind === 'video' && (
                    <span className="absolute inset-0 grid place-items-center bg-black/30 text-white text-lg">
                      ▶
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {zoomed !== null && (
        <Lightbox
          shots={shots}
          index={zoomed}
          onIndex={setZoomed}
          onClose={() => setZoomed(null)}
        />
      )}
    </div>
  )
}
