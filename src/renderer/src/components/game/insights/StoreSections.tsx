import { useState, type ReactNode } from 'react'
import type { AboutBlock, Game, Requirement, StoreInfo } from '@shared/models'
import { formatFullDate } from '@shared/format'
import { Chip } from '@renderer/components/ui/Chip'
import { useGameNews } from '@renderer/lib/queries'
import { ExternalLink, SectionLabel } from './common'

const PLATFORM_LABELS = { windows: 'Windows', mac: 'macOS', linux: 'Linux / SteamOS' } as const
const CONTROLLER_LABELS = { full: 'Compatibilité complète', partial: 'Compatibilité partielle' }

/** Paragraphs shown before "Lire la suite". */
const ABOUT_PREVIEW = 4

/** Steam "About this game": headings, paragraphs and images, folded after a few blocks. */
export function AboutSection({ blocks }: { blocks: AboutBlock[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!blocks.length) return null
  const shown = expanded ? blocks : blocks.slice(0, ABOUT_PREVIEW)
  return (
    <section data-testid="about" className="flex flex-col gap-2.5 max-w-[760px]">
      <SectionLabel>À PROPOS DU JEU</SectionLabel>
      <div className="relative flex flex-col gap-2.5">
        {shown.map((block, i) =>
          block.kind === 'heading' ? (
            <h3 key={i} className="mt-2 font-display font-bold text-text-hi tracking-[.02em]">
              {block.text}
            </h3>
          ) : block.kind === 'image' ? (
            <img key={i} src={block.url} alt="" loading="lazy" className="max-w-full rounded-md" />
          ) : (
            <p key={i} className="text-[15px] leading-[1.65] text-text-mid select-text">
              {block.text}
            </p>
          )
        )}
        {!expanded && blocks.length > ABOUT_PREVIEW && (
          <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(transparent,var(--surface-page))] pointer-events-none" />
        )}
      </div>
      {blocks.length > ABOUT_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="self-start text-sm font-semibold text-text-lo hover:text-text-hi cursor-pointer"
        >
          {expanded ? 'Réduire' : 'Lire la suite'}
        </button>
      )}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <dt className="text-[11px] font-semibold tracking-[.12em] text-text-lo">{label}</dt>
      <dd className="text-sm text-text-hi">{children}</dd>
    </div>
  )
}

/** Store facts (studio, release, platforms, price…) and Steam features. */
export function StoreFacts({ store }: { store: StoreInfo }) {
  const developers = store.developers.join(', ')
  const publishers = store.publishers.join(', ')
  return (
    <section data-testid="store-facts" className="flex flex-col gap-4 max-w-[760px]">
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-6 gap-y-3.5 p-4 rounded-lg bg-ink-800 border border-ink-600">
        {developers && <Fact label="DÉVELOPPEUR">{developers}</Fact>}
        {publishers && publishers !== developers && <Fact label="ÉDITEUR">{publishers}</Fact>}
        {store.releaseDate && (
          <Fact label={store.comingSoon ? 'SORTIE PRÉVUE' : 'DATE DE SORTIE'}>
            {store.releaseDate}
          </Fact>
        )}
        {store.platforms.length > 0 && (
          <Fact label="PLATEFORMES">
            {store.platforms.map((p) => PLATFORM_LABELS[p]).join(' · ')}
          </Fact>
        )}
        {store.controller && <Fact label="MANETTES">{CONTROLLER_LABELS[store.controller]}</Fact>}
        {store.price && (
          <Fact label="PRIX SUR STEAM">
            {store.price}
            {store.discountPercent > 0 && (
              <span className="ml-2 px-1.5 rounded bg-green-300/15 text-green-300 text-xs font-semibold">
                −{store.discountPercent} %
              </span>
            )}
          </Fact>
        )}
      </dl>
      {store.features.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel>CARACTÉRISTIQUES</SectionLabel>
          <div data-testid="features" className="flex flex-wrap gap-2">
            {store.features.map((feature) => (
              <Chip key={feature} variant="outline" tabIndex={-1}>
                {feature}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function RequirementList({ title, items }: { title: string; items: Requirement[] }) {
  return (
    <div className="flex-1 min-w-[240px] flex flex-col gap-1.5">
      <b className="text-sm text-text-hi font-semibold">{title}</b>
      <dl className="flex flex-col gap-1">
        {items.map((item, i) => (
          <div key={i} className="text-[13px] leading-snug">
            {item.label && <dt className="inline text-text-lo">{item.label} : </dt>}
            <dd className="inline text-text-mid">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Requirements({ store }: { store: StoreInfo }) {
  const { minimum, recommended } = store.requirements
  if (!minimum.length && !recommended.length) return null
  return (
    <section data-testid="requirements" className="flex flex-col gap-2.5 max-w-[760px]">
      <SectionLabel>CONFIGURATION REQUISE (WINDOWS)</SectionLabel>
      <div className="flex flex-wrap gap-6 p-4 rounded-lg bg-ink-800 border border-ink-600">
        {minimum.length > 0 && <RequirementList title="Minimale" items={minimum} />}
        {recommended.length > 0 && <RequirementList title="Recommandée" items={recommended} />}
      </div>
    </section>
  )
}

export function Languages({ store }: { store: StoreInfo }) {
  if (!store.languages.length) return null
  return (
    <section data-testid="languages" className="flex flex-col gap-2 max-w-[760px]">
      <SectionLabel>LANGUES · {store.languages.length}</SectionLabel>
      <p className="text-sm text-text-mid leading-relaxed">
        {store.languages.map((language, i) => (
          <span key={language.name}>
            {i > 0 && ', '}
            <span className={language.audio ? 'text-text-hi' : ''}>{language.name}</span>
            {language.audio && <span title="Audio complet"> 🔊</span>}
          </span>
        ))}
      </p>
      {store.languages.some((l) => l.audio) && (
        <span className="text-xs text-text-lo">🔊 Audio complet</span>
      )}
    </section>
  )
}

const NEWS_PREVIEW = 3

/** The latest news as compact rows, with a link to the news tab. */
export function LatestNews({ game, onMore }: { game: Game; onMore: () => void }) {
  const news = useGameNews(game, true)
  const items = news.data?.slice(0, NEWS_PREVIEW) ?? []
  if (!items.length) return null
  return (
    <section data-testid="latest-news" className="flex flex-col gap-2 max-w-[760px]">
      <div className="flex items-center">
        <SectionLabel>DERNIÈRES ACTUALITÉS</SectionLabel>
        <button
          type="button"
          onClick={onMore}
          className="ml-auto text-xs font-semibold text-text-lo hover:text-text-hi cursor-pointer"
        >
          Toutes les actualités →
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <ExternalLink
              href={item.url}
              className="flex items-center gap-3 p-2 rounded-md hover:bg-ink-800 transition-colors"
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="w-[96px] aspect-[16/9] flex-none rounded object-cover bg-ink-700"
                />
              ) : (
                <div className="w-[96px] aspect-[16/9] flex-none rounded bg-ink-700" />
              )}
              <div className="min-w-0 flex flex-col">
                <b className="text-sm text-text-hi font-semibold truncate">{item.title}</b>
                <span className="text-xs text-text-lo">
                  <span className={item.official ? 'text-green-300' : ''}>{item.feed}</span> ·{' '}
                  {formatFullDate(item.date)}
                </span>
              </div>
            </ExternalLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
