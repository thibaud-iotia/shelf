import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { AppError } from '../../shared/errors'
import type { GameInput, GamePatch } from '../../shared/models'

const MAX_TITLE = 200
const MAX_ARGS = 2000
const MAX_TEXT = 20_000

function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('VALIDATION', 'Le titre est obligatoire.')
  }
  if (value.trim().length > MAX_TITLE) {
    throw new AppError('VALIDATION', `Le titre dépasse ${MAX_TITLE} caractères.`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string, max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new AppError('VALIDATION', `${label} invalide.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new AppError('VALIDATION', `${label} trop long.`)
  return trimmed || null
}

export function executable(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('VALIDATION', 'Choisissez un exécutable.')
  }
  const path = value.trim()
  if (!isAbsolute(path))
    throw new AppError('VALIDATION', 'Le chemin de l’exécutable doit être absolu.')
  if (!existsSync(path)) throw new AppError('VALIDATION', `Exécutable introuvable : ${path}`)
  return path
}

function directory(value: unknown, label: string): string | null {
  const path = optionalText(value, label)
  if (path === null) return null
  if (!isAbsolute(path)) throw new AppError('VALIDATION', `${label} : chemin absolu attendu.`)
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new AppError('VALIDATION', `${label} introuvable : ${path}`)
  }
  return path
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new AppError('VALIDATION', `${label} invalide.`)
  return value
}

export function validateGameId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppError('VALIDATION', 'Identifiant de jeu invalide.')
  }
  return value
}

export function validateGameInput(input: unknown): Required<GameInput> {
  if (!input || typeof input !== 'object') throw new AppError('VALIDATION', 'Données invalides.')
  const raw = input as Record<string, unknown>
  return {
    title: title(raw.title),
    executablePath: executable(raw.executablePath),
    launchArgs: optionalText(raw.launchArgs, 'Arguments', MAX_ARGS),
    installPath: directory(raw.installPath, 'Dossier du jeu')
  }
}

export function validateGamePatch(patch: unknown): GamePatch {
  if (!patch || typeof patch !== 'object') throw new AppError('VALIDATION', 'Données invalides.')
  const raw = patch as Record<string, unknown>
  const out: GamePatch = {}
  if ('title' in raw) out.title = title(raw.title)
  if ('executablePath' in raw) {
    out.executablePath = raw.executablePath === null ? null : executable(raw.executablePath)
  }
  if ('launchArgs' in raw) out.launchArgs = optionalText(raw.launchArgs, 'Arguments', MAX_ARGS)
  if ('installPath' in raw) out.installPath = directory(raw.installPath, 'Dossier du jeu')
  if ('favorite' in raw) out.favorite = bool(raw.favorite, 'Favori')
  if ('hidden' in raw) out.hidden = bool(raw.hidden, 'Masqué')
  if ('useRunner' in raw) out.useRunner = bool(raw.useRunner, 'Runner')
  if ('description' in raw) out.description = optionalText(raw.description, 'Description')
  if ('developer' in raw) out.developer = optionalText(raw.developer, 'Studio', MAX_TITLE)
  if ('releaseDate' in raw) {
    const date = optionalText(raw.releaseDate, 'Date de sortie', 10)
    if (date !== null && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) {
      throw new AppError('VALIDATION', 'Date de sortie attendue au format AAAA-MM-JJ.')
    }
    out.releaseDate = date
  }
  if ('genres' in raw) {
    if (!Array.isArray(raw.genres) || raw.genres.some((g) => typeof g !== 'string')) {
      throw new AppError('VALIDATION', 'Genres invalides.')
    }
    out.genres = (raw.genres as string[]).map((g) => g.trim()).filter(Boolean)
  }
  if ('savePath' in raw) out.savePath = directory(raw.savePath, 'Dossier de sauvegardes')
  return out
}
