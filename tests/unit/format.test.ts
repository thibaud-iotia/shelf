import { describe, expect, it } from 'vitest'
import {
  formatUsd,
  formatBytes,
  formatLastSession,
  formatPlaytime,
  formatPlaytimeShort,
  pluralize,
  yearOf,
  formatCount,
  formatFullDate
} from '../../src/shared/format'

describe('format', () => {
  it.each([
    [0, '0 min'],
    [45, '< 1 min'],
    [25 * 60, '25 min'],
    [42 * 3600 + 15 * 60, '42 h 15'],
    [3600 + 5 * 60, '1 h 05']
  ])('formatPlaytime(%i) = %s', (seconds, text) => {
    expect(formatPlaytime(seconds)).toBe(text)
  })

  it('formats short playtime', () => {
    expect(formatPlaytimeShort(42 * 3600 + 900)).toBe('42 h')
    expect(formatPlaytimeShort(600)).toBe('10 min')
  })

  it('formats the last session relative to now', () => {
    const now = new Date(2026, 9, 18, 15, 0).getTime()
    expect(formatLastSession(null, null, now)).toBe('Jamais')
    // Date from the launcher: no session length.
    expect(formatLastSession(new Date(2026, 9, 17, 22, 0).getTime(), null, now)).toBe('Hier')
    expect(formatLastSession(new Date(2026, 9, 17, 22, 0).getTime(), 4800, now)).toBe(
      'Hier, 1 h 20'
    )
    expect(formatLastSession(new Date(2026, 9, 18, 9, 0).getTime(), 600, now)).toBe(
      'Aujourd’hui, 10 min'
    )
  })

  it('formats sizes and counts', () => {
    expect(formatBytes(412 * 1024 * 1024)).toBe('412 Mo')
    expect(formatBytes(1536)).toBe('1,5 Ko')
    expect(pluralize(1, 'jeu', 'jeux')).toBe('1 jeu')
    expect(pluralize(3, 'jeu', 'jeux')).toBe('3 jeux')
    expect(yearOf('2020-09-17')).toBe(2020)
    expect(yearOf(null)).toBeNull()
  })
})

describe('game page numbers and dates', () => {
  it('groups thousands and prints full dates in French', () => {
    expect(formatCount(287755).replace(/\s/g, ' ')).toBe('287 755')
    expect(formatFullDate(new Date(2025, 8, 17, 12).getTime())).toBe('17 sept. 2025')
  })
})

describe('store prices', () => {
  it('formats CheapShark prices in US dollars, French style', () => {
    expect(formatUsd(24.99)).toMatch(/^24,99\s\$$/)
    expect(formatUsd(1234.5)).toMatch(/^1\s234,50\s\$$/)
    expect(formatUsd(0)).toBe('Gratuit')
  })
})
