import { useState } from 'react'
import type { GameVideo } from '@shared/models'
import { ExternalLink } from './common'

/** Player of the selected video; nothing is loaded from the network before a click. */
export function Player({ video }: { video: GameVideo }) {
  const [playing, setPlaying] = useState(false)
  if (!playing) {
    return (
      <button
        type="button"
        onClick={() => setPlaying(true)}
        aria-label={`Lire « ${video.title} »`}
        className="group relative w-full aspect-video rounded-lg overflow-hidden bg-ink-800 cursor-pointer"
      >
        {video.posterUrl && (
          <img
            src={video.posterUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/30 group-hover:bg-black/10 transition-colors">
          <span className="grid place-items-center w-16 h-16 rounded-full bg-grad-brand text-white text-2xl shadow-glow-brand">
            ▶
          </span>
        </span>
      </button>
    )
  }
  if (video.kind === 'youtube') {
    return (
      <iframe
        data-testid="video-player"
        src={video.sources[0]}
        title={video.title}
        className="w-full aspect-video rounded-lg bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    )
  }
  return (
    <video
      data-testid="video-player"
      key={video.id}
      controls
      autoPlay
      poster={video.posterUrl ?? undefined}
      className="w-full aspect-video rounded-lg bg-black"
    >
      {video.sources.map((src) => (
        <source key={src} src={src} type="video/mp4" />
      ))}
    </video>
  )
}

export function VideosPanel({ videos }: { videos: GameVideo[] }) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id)
  const selected = videos.find((v) => v.id === selectedId) ?? videos[0]
  if (!selected) return <p className="text-sm text-text-lo">Aucune vidéo.</p>
  return (
    <div data-testid="videos" className="flex flex-col gap-3 max-w-[860px]">
      <Player key={selected.id} video={selected} />
      <div className="flex items-center gap-2 text-sm">
        <b className="text-text-hi font-semibold truncate">{selected.title}</b>
        <ExternalLink
          href={selected.pageUrl}
          className="ml-auto flex-none text-xs text-text-lo! hover:text-text-hi!"
        >
          {selected.kind === 'youtube' ? 'Ouvrir sur YouTube ↗' : 'Page Steam ↗'}
        </ExternalLink>
      </div>
      {videos.length > 1 && (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {videos.map((video) => (
            <li key={video.id} className="flex-none">
              <button
                type="button"
                onClick={() => setSelectedId(video.id)}
                aria-pressed={video.id === selected.id}
                aria-label={video.title}
                title={video.title}
                className={`relative block w-[160px] aspect-video rounded-md overflow-hidden bg-ink-800 border-2 cursor-pointer ${
                  video.id === selected.id
                    ? 'border-brand'
                    : 'border-transparent hover:border-ink-400'
                }`}
              >
                {video.posterUrl && (
                  <img
                    src={video.posterUrl}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                )}
                <span className="absolute left-1.5 bottom-1 px-1.5 rounded bg-black/70 text-[10px] font-semibold text-white">
                  {video.kind === 'youtube' ? 'YouTube' : 'Steam'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
