// Human-readable formatting shared by the renderer and the tray menu. French UI.

const DAY_MS = 86_400_000

/** 0 → "0 min", 45 s → "< 1 min", 25 min → "25 min", 42 h 15 → "42 h 15". */
export function formatPlaytime(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0))
  if (total === 0) return '0 min'
  if (total < 60) return '< 1 min'
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`
}

/** Compact form for lists: "42 h", "25 min". */
export function formatPlaytimeShort(seconds: number | null | undefined): string {
  const minutes = Math.floor(Math.max(0, seconds ?? 0) / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h`
}

function startOfDay(time: number): number {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Aujourd’hui", "Hier", "12 oct.", "12 oct. 2024". */
export function formatDay(time: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS)
  if (days === 0) return 'Aujourd’hui'
  if (days === 1) return 'Hier'
  const date = new Date(time)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

/** "Hier, 1 h 20" — or "Jamais" when the game was never played through Shelf. */
export function formatLastSession(
  playedAt: number | null,
  durationSec: number | null,
  now: number = Date.now()
): string {
  if (playedAt === null) return 'Jamais'
  return `${formatDay(playedAt, now)}, ${formatPlaytime(durationSec)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  const units = ['Ko', 'Mo', 'Go', 'To']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1).replace('.', ',') : Math.round(value)} ${units[unit]}`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count > 1 ? plural : singular}`
}

/** Year from an ISO-like date ("2020-09-17" → 2020). */
export function yearOf(date: string | null): number | null {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : NaN
  return Number.isFinite(year) ? year : null
}
