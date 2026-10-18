import { eq } from 'drizzle-orm'
import { GAME_SOURCES } from '../../shared/domain'
import { AppError } from '../../shared/errors'
import type { AppSettings } from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { settings } from '../db/schema'

export const DEFAULT_SETTINGS: AppSettings = {
  onboardingDone: false,
  enabledLaunchers: GAME_SOURCES.filter((s) => s !== 'manual'),
  scanFolders: [],
  extraExclusions: [],
  launchAtStartup: false,
  minimizeToTray: false,
  runnerPath: null,
  gogOAuthEnabled: false,
  coverSize: 'md',
  showHidden: false
}

type Validator<K extends keyof AppSettings> = (value: unknown) => AppSettings[K]

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

function boolean(label: string) {
  return (v: unknown): boolean => {
    if (typeof v !== 'boolean') throw new AppError('VALIDATION', `${label} : valeur invalide.`)
    return v
  }
}

function strings(label: string) {
  return (v: unknown): string[] => {
    if (!isStringArray(v)) throw new AppError('VALIDATION', `${label} : liste invalide.`)
    return [...new Set(v.map((s) => s.trim()).filter(Boolean))]
  }
}

const validators: { [K in keyof AppSettings]: Validator<K> } = {
  onboardingDone: boolean('Introduction'),
  enabledLaunchers: (v) => {
    if (!isStringArray(v) || v.some((s) => !(GAME_SOURCES as readonly string[]).includes(s))) {
      throw new AppError('VALIDATION', 'Launchers : liste invalide.')
    }
    return v as AppSettings['enabledLaunchers']
  },
  scanFolders: strings('Dossiers'),
  extraExclusions: strings('Exclusions'),
  launchAtStartup: boolean('Lancement au démarrage'),
  minimizeToTray: boolean('Barre système'),
  runnerPath: (v) => {
    if (v === null || v === '') return null
    if (typeof v !== 'string') throw new AppError('VALIDATION', 'Chemin du runner invalide.')
    return v.trim() || null
  },
  gogOAuthEnabled: boolean('Connexion GOG'),
  coverSize: (v) => {
    if (v !== 'sm' && v !== 'md' && v !== 'lg') {
      throw new AppError('VALIDATION', 'Taille de jaquette invalide.')
    }
    return v
  },
  showHidden: boolean('Jeux masqués')
}

/** Typed key/value settings persisted as JSON in the `settings` table. */
export class SettingsStore {
  constructor(private readonly db: ShelfDatabase) {}

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get()
    if (!row) return DEFAULT_SETTINGS[key]
    try {
      return validators[key](JSON.parse(row.value))
    } catch {
      return DEFAULT_SETTINGS[key]
    }
  }

  all(): AppSettings {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      out[key] = this.get(key)
    }
    return out as unknown as AppSettings
  }

  update(patch: unknown): AppSettings {
    if (!patch || typeof patch !== 'object') throw new AppError('VALIDATION', 'Réglages invalides.')
    const validated = Object.entries(patch as Record<string, unknown>).map(([key, value]) => {
      if (!Object.hasOwn(validators, key)) {
        throw new AppError('VALIDATION', `Réglage inconnu : ${key}`)
      }
      const validate = validators[key as keyof AppSettings] as (v: unknown) => unknown
      return [key, JSON.stringify(validate(value))] as const
    })
    this.db.transaction((tx) => {
      for (const [key, value] of validated) {
        tx.insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } })
          .run()
      }
    })
    return this.all()
  }
}
