import { useState, type ReactNode } from 'react'
import { INSTALL_STATE_LABELS, SOURCE_LABELS } from '@shared/domain'
import { formatDay, formatLastSession, formatPlaytime, yearOf } from '@shared/format'
import type { Game } from '@shared/models'
import { heroGradient } from '@renderer/lib/artwork'
import { MetadataDialog } from '@renderer/components/game/MetadataDialog'
import { TagEditor } from '@renderer/components/game/TagEditor'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { usePlay } from '@renderer/lib/actions'
import {
  useGameDetail,
  useInstallGame,
  useOpenFolder,
  usePickCover,
  useRefreshArtwork,
  useSettings,
  useUpdateGame
} from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { useIsRunning } from '@renderer/stores/running'
import { useUiStore } from '@renderer/stores/ui'

function Label({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <span
      className={`text-[11px] font-semibold tracking-[.12em] text-text-lo ${first ? '' : 'mt-3.5'}`}
    >
      {children}
    </span>
  )
}

function SideCard({ game, children }: { game: Game; children?: ReactNode }) {
  const dot =
    game.installState === 'installed'
      ? 'bg-green-300'
      : game.installState === 'not_installed'
        ? 'bg-ink-400'
        : 'bg-amber-300'
  return (
    <aside className="w-[280px] flex-none self-start flex flex-col gap-1 p-[22px] rounded-lg bg-ink-800 border border-ink-600">
      <Label first>TEMPS DE JEU</Label>
      <b data-testid="playtime" className="font-display font-bold text-4xl text-text-hi">
        {formatPlaytime(game.playtimeSec)}
      </b>
      {game.externalPlaytimeMin !== null && (
        <span data-testid="external-playtime" className="text-[13px] text-text-lo">
          {SOURCE_LABELS[game.source]} : {formatPlaytime(game.externalPlaytimeMin * 60)}
        </span>
      )}
      <Label>DERNIÈRE SESSION</Label>
      <span data-testid="last-session" className="text-text-hi">
        {formatLastSession(game.lastPlayedAt, game.lastSessionSec)}
      </span>
      <Label>SOURCE</Label>
      <span className="flex items-center gap-2 text-text-hi">
        <i className={`w-2 h-2 rounded-full ${dot}`} />
        {SOURCE_LABELS[game.source]} · {INSTALL_STATE_LABELS[game.installState]}
      </span>
      {(game.installPath ?? game.executablePath) && (
        <span className="mt-1.5 font-mono text-xs text-text-lo break-all select-text">
          {game.installPath ?? game.executablePath}
        </span>
      )}
      {children}
    </aside>
  )
}

function SideAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-sm text-text-mid hover:text-text-hi cursor-pointer"
    >
      {children}
    </button>
  )
}

function ArtworkActions({ game }: { game: Game }) {
  const settings = useSettings()
  const pickCover = usePickCover()
  const refresh = useRefreshArtwork()
  const [searching, setSearching] = useState(false)
  const canFetch = settings.data?.igdbConfigured || settings.data?.steamGridDbConfigured

  return (
    <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-ink-600">
      {settings.data?.igdbConfigured && (
        <SideAction onClick={() => setSearching(true)}>Rechercher les métadonnées…</SideAction>
      )}
      {canFetch && (
        <SideAction
          onClick={() =>
            refresh.mutate([game.id], {
              onSuccess: () => toast.success('Visuels actualisés')
            })
          }
        >
          {refresh.isPending ? 'Téléchargement…' : 'Actualiser les visuels'}
        </SideAction>
      )}
      <SideAction onClick={() => pickCover.mutate([game.id])}>Changer la jaquette…</SideAction>
      {searching && <MetadataDialog game={game} onClose={() => setSearching(false)} />}
    </div>
  )
}

export function GameDetailView({ gameId }: { gameId: number }) {
  const detail = useGameDetail(gameId)
  const back = useUiStore((s) => s.back)
  const openGameForm = useUiStore((s) => s.openGameForm)
  const running = useIsRunning(gameId)
  const play = usePlay()
  const openFolder = useOpenFolder()
  const install = useInstallGame()
  const update = useUpdateGame()

  if (detail.isError) {
    return (
      <section className="flex-1 px-10 py-8 text-red-300" role="alert">
        {detail.error.message}
      </section>
    )
  }
  if (!detail.data) return null
  const { game, sessions } = detail.data
  const year = yearOf(game.releaseDate)
  const meta = [year, game.developer].filter(Boolean).join(' · ')

  return (
    <section className="flex-1 min-w-0 flex flex-col -mt-[var(--title-bar)]">
      <div
        className="relative h-[340px] flex-none bg-cover bg-center"
        style={{ background: game.heroUrl ? undefined : heroGradient(game.title) }}
      >
        {game.heroUrl && (
          <img src={game.heroUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(transparent_40%,var(--surface-page))]" />
        <nav className="absolute left-10 top-[calc(var(--title-bar)+8px)] flex items-center gap-1.5 text-xs text-text-mid">
          <button
            type="button"
            onClick={back}
            className="app-no-drag hover:text-text-hi cursor-pointer"
          >
            ← Bibliothèque
          </button>
          <span className="text-text-lo">/ {game.title}</span>
        </nav>
        {game.logoUrl ? (
          <img
            src={game.logoUrl}
            alt={game.title}
            className="absolute left-10 bottom-[30px] max-h-[110px] max-w-[45%] object-contain object-left"
          />
        ) : (
          <h1 className="absolute left-10 bottom-[30px] max-w-[50%] font-display font-bold text-[64px] leading-none tracking-[-.03em] text-white">
            {game.title}
          </h1>
        )}
        {game.logoUrl && <h1 className="sr-only">{game.title}</h1>}
        <div className="absolute right-10 bottom-[34px] flex items-center gap-2.5">
          {game.installState === 'not_installed' && game.canInstall ? (
            <Button size="lg" onClick={() => install.mutate(game.id)}>
              Installer
            </Button>
          ) : (
            <Button size="lg" disabled={running} onClick={() => void play(game)}>
              {running ? '● En cours…' : '▶ Jouer'}
            </Button>
          )}
          <Button variant="secondary" size="lg" onClick={() => openFolder.mutate(game.id)}>
            Dossier
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => openGameForm({ mode: 'edit', gameId: game.id })}
          >
            Modifier
          </Button>
          <Button
            variant="secondary"
            size="lg"
            aria-label={game.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            aria-pressed={game.favorite}
            className={game.favorite ? 'text-red-300!' : ''}
            onClick={() => update.mutate([game.id, { favorite: !game.favorite }])}
          >
            {game.favorite ? '♥' : '♡'}
          </Button>
        </div>
      </div>

      <div className="flex gap-10 px-10 pt-2 pb-8">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {(game.genres.length > 0 || meta) && (
            <div className="flex flex-wrap items-center gap-2">
              {game.genres.map((genre) => (
                <Chip key={genre} variant="outline" tabIndex={-1}>
                  {genre}
                </Chip>
              ))}
              {meta && <span className="text-text-lo">· {meta}</span>}
            </div>
          )}
          {game.description && (
            <p className="max-w-[640px] text-base leading-[1.65] text-text-mid select-text whitespace-pre-line">
              {game.description}
            </p>
          )}
          <TagEditor game={game} />
          {game.screenshotUrls.length > 0 && (
            <div className="flex gap-3.5 mt-1.5 overflow-x-auto">
              {game.screenshotUrls.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="w-[200px] aspect-[16/10] rounded-[12px] object-cover flex-none"
                />
              ))}
            </div>
          )}
          {sessions.length > 0 && (
            <div className="flex flex-col gap-2 mt-2">
              <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">
                SESSIONS
              </span>
              <ul data-testid="sessions" className="flex flex-col gap-1 max-w-[640px]">
                {sessions.slice(0, 8).map((s) => (
                  <li key={s.id} className="flex text-sm text-text-mid">
                    <span>
                      {formatDay(s.startedAt)},{' '}
                      {new Date(s.startedAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    <span className="ml-auto font-mono text-xs text-text-lo">
                      {formatPlaytime(s.durationSec)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <SideCard game={game}>
          <ArtworkActions game={game} />
        </SideCard>
      </div>
    </section>
  )
}
