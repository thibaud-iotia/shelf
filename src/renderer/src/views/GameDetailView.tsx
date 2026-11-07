import { useState, type ReactNode } from 'react'
import { INSTALL_STATE_LABELS, SOURCE_LABELS } from '@shared/domain'
import { formatDay, formatLastSession, formatPlaytime, yearOf } from '@shared/format'
import type { Game, GameDlc } from '@shared/models'
import { heroGradient } from '@renderer/lib/artwork'
import { BackBar, TabBar } from '@renderer/components/game/DetailChrome'
import { availableTabs, type DetailTab } from '@renderer/lib/detail'
import { MetadataDialog } from '@renderer/components/game/MetadataDialog'
import { TagEditor } from '@renderer/components/game/TagEditor'
import { AchievementsPanel } from '@renderer/components/game/insights/AchievementsPanel'
import { CommunityPanel } from '@renderer/components/game/insights/CommunityPanel'
import { InsightsSide } from '@renderer/components/game/insights/InsightsSide'
import { MediaGallery } from '@renderer/components/game/insights/MediaGallery'
import {
  AboutSection,
  GameLatestNews,
  Languages,
  Requirements,
  StoreFacts
} from '@renderer/components/game/insights/StoreSections'
import { GameNewsPanel } from '@renderer/components/game/insights/NewsPanel'
import { VideosPanel } from '@renderer/components/game/insights/VideosPanel'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { LaunchPending } from '@renderer/components/game/LaunchStatus'
import { usePlay } from '@renderer/lib/actions'
import {
  useGameDetail,
  useGameInsights,
  useApplyUpdate,
  useInstallGame,
  useOpenFolder,
  useExportSaves,
  usePickCover,
  usePickSaveFolder,
  useRefreshArtwork,
  useSettings,
  useUpdateGame
} from '@renderer/lib/queries'
import { toast } from '@renderer/stores/toasts'
import { useIsRunning, useLaunchProgress } from '@renderer/stores/running'
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

const DLC_PREVIEW = 6

/** Add-ons owned for this game: listed here, never as games of their own. */
function DlcList({ dlcs }: { dlcs: GameDlc[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? dlcs : dlcs.slice(0, DLC_PREVIEW)
  return (
    <div className="flex flex-col gap-2 mt-2">
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">
        CONTENUS ADDITIONNELS · {dlcs.length}
      </span>
      <ul data-testid="dlcs" className="flex flex-col gap-1 max-w-[640px]">
        {shown.map((dlc) => (
          <li key={dlc.id} className="text-sm text-text-mid truncate" title={dlc.title}>
            {dlc.title}
          </li>
        ))}
      </ul>
      {dlcs.length > DLC_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="self-start text-xs text-text-lo hover:text-text-hi cursor-pointer"
        >
          {expanded ? 'Réduire' : `Afficher les ${dlcs.length}`}
        </button>
      )}
    </div>
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
        <span data-testid="playtime-origin" className="text-[13px] text-text-lo">
          Selon {SOURCE_LABELS[game.source]}
          {game.localPlaytimeSec > 0 &&
            ` · dont ${formatPlaytime(game.localPlaytimeSec)} lancé hors ${SOURCE_LABELS[game.source]}`}
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

function SavesActions({ game }: { game: Game }) {
  const pick = usePickSaveFolder()
  const exportSaves = useExportSaves()
  return (
    <div data-testid="saves" className="flex flex-col gap-2 mt-4 pt-4 border-t border-ink-600">
      <span className="text-[11px] font-semibold tracking-[.12em] text-text-lo">SAUVEGARDES</span>
      <span
        data-testid="save-path"
        className="font-mono text-xs text-text-lo break-all select-text"
      >
        {game.savePath ?? 'Aucun dossier défini'}
      </span>
      <SideAction onClick={() => pick.mutate([game.id])}>
        {game.savePath ? 'Changer le dossier…' : 'Choisir le dossier…'}
      </SideAction>
      {game.savePath && (
        <SideAction onClick={() => exportSaves.mutate(game.id)}>
          {exportSaves.isPending ? 'Export…' : 'Exporter (.zip)…'}
        </SideAction>
      )}
    </div>
  )
}

function RemoveAction({ game }: { game: Game }) {
  const openRemoveGame = useUiStore((s) => s.openRemoveGame)
  return (
    <div className="flex flex-col gap-2 mt-4 pt-4 border-t border-ink-600">
      <SideAction onClick={() => openRemoveGame(game.id)}>
        {game.canUninstall ? 'Désinstaller ou supprimer…' : 'Supprimer…'}
      </SideAction>
    </div>
  )
}

export function GameDetailView({ gameId }: { gameId: number }) {
  const detail = useGameDetail(gameId)
  const insights = useGameInsights(detail.data?.game)
  const [selectedTab, setTab] = useState<DetailTab>('overview')
  const openGameForm = useUiStore((s) => s.openGameForm)
  const running = useIsRunning(gameId)
  const launching = useLaunchProgress(gameId)
  const play = usePlay()
  const openFolder = useOpenFolder()
  const install = useInstallGame()
  const applyUpdate = useApplyUpdate()
  const update = useUpdateGame()

  if (detail.isError) {
    return (
      <section className="flex-1 px-10 py-8 text-red-300" role="alert">
        {detail.error.message}
      </section>
    )
  }
  if (!detail.data) return null
  const { game, sessions, dlcs } = detail.data
  const store = insights.data?.store ?? null
  // IGDB first (chosen by the user), the Steam store page fills the gaps.
  const year = yearOf(game.releaseDate) ?? store?.releaseDate?.match(/\d{4}/)?.[0] ?? null
  const developer = game.developer ?? store?.developers[0] ?? null
  const meta = [year, developer].filter(Boolean).join(' · ')
  const genres = game.genres.length ? game.genres : (store?.genres ?? [])
  const description = game.description ?? store?.shortDescription ?? null
  const shots = store?.screenshots.length
    ? store.screenshots
    : game.screenshotUrls.map((url) => ({ thumbUrl: url, fullUrl: url }))
  const tabs = availableTabs(insights.data)
  const tab = tabs.some((t) => t.id === selectedTab) ? selectedTab : 'overview'

  return (
    <section className="flex-1 min-w-0 flex flex-col -mt-[var(--title-bar)]">
      <BackBar title={game.title} />
      <div
        className="relative h-[340px] flex-none bg-cover bg-center"
        style={{ background: game.heroUrl ? undefined : heroGradient(game.title) }}
      >
        {game.heroUrl && (
          <img src={game.heroUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(transparent_40%,var(--surface-page))]" />
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
          ) : launching && !running ? (
            <LaunchPending progress={launching} />
          ) : game.canUpdate && !running ? (
            <Button size="lg" onClick={() => applyUpdate.mutate(game.id)}>
              ⟳ Mettre à jour
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
          {tabs.length > 1 && <TabBar tabs={tabs} active={tab} onChange={setTab} />}
          {tab === 'news' && <GameNewsPanel game={game} />}
          {tab === 'videos' && insights.data && <VideosPanel videos={insights.data.videos} />}
          {tab === 'community' && <CommunityPanel game={game} />}
          {tab === 'achievements' && <AchievementsPanel game={game} />}
          {tab === 'overview' && (
            <>
              <MediaGallery video={insights.data?.videos[0]} shots={shots} />
              {(genres.length > 0 || meta) && (
                <div className="flex flex-wrap items-center gap-2">
                  {genres.map((genre) => (
                    <Chip key={genre} variant="outline" tabIndex={-1}>
                      {genre}
                    </Chip>
                  ))}
                  {meta && <span className="text-text-lo">· {meta}</span>}
                </div>
              )}
              {description && (
                <p
                  data-testid="description"
                  className="max-w-[760px] text-base leading-[1.65] text-text-mid select-text whitespace-pre-line"
                >
                  {description}
                </p>
              )}
              {store && <StoreFacts store={store} />}
              <TagEditor game={game} />
              {insights.data?.steamAppId && (
                <GameLatestNews game={game} onMore={() => setTab('news')} />
              )}
              {store && <AboutSection blocks={store.about} />}
              {dlcs.length > 0 && <DlcList dlcs={dlcs} />}
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
              {store && <Requirements store={store} />}
              {store && <Languages store={store} />}
            </>
          )}
        </div>
        <SideCard game={game}>
          {insights.data && <InsightsSide insights={insights.data} />}
          <ArtworkActions game={game} />
          <SavesActions game={game} />
          <RemoveAction game={game} />
        </SideCard>
      </div>
    </section>
  )
}
