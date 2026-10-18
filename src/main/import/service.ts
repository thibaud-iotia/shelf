import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { GameSourceId } from '../../shared/domain'
import { AppError } from '../../shared/errors'
import type {
  ImportCandidate,
  ImportDecision,
  ImportReport,
  LauncherStatus,
  ScanResult,
  SourceError
} from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { games } from '../db/schema'
import type { SettingsStore } from '../settings/store'
import { scanFolder, type FolderFinding } from '../sources/folder-scan'
import type { DetectedGame, GameSource } from '../sources/types'
import { buildCandidates } from './candidates'

interface LastScan {
  candidates: Map<string, ImportCandidate>
  /** Launchers scanned without error, with the ids they reported. */
  scanned: Map<GameSourceId, Set<string>>
}

/** number = chosen IGDB match, null = none wanted, undefined = automatic. */
export interface ImportedGame {
  id: number
  igdbId?: number | null
}

/** Detection of launchers and folders, then application of the user's decisions. */
export class ImportService {
  private lastScan: LastScan | null = null

  constructor(
    private readonly db: ShelfDatabase,
    private readonly settings: SettingsStore,
    private readonly sources: GameSource[],
    /** Called with the games created or updated by `apply` (metadata enrichment). */
    private readonly onImported: (games: ImportedGame[]) => void = () => {}
  ) {}

  async launchers(): Promise<LauncherStatus[]> {
    const enabled = this.settings.get('enabledLaunchers')
    return Promise.all(
      this.sources.map(async (source) => {
        // Unofficial integrations are isolated: a failure only marks the launcher as absent.
        const location = await source.locate().catch(() => null)
        const count = location ? (await source.scan().catch(() => [])).length : 0
        return {
          source: source.id,
          name: source.name,
          available: location !== null,
          location,
          gameCount: count,
          enabled: enabled.includes(source.id)
        }
      })
    )
  }

  async scan(
    options: { includeLaunchers?: boolean; folders?: string[] } = {}
  ): Promise<ScanResult> {
    const enabled = new Set(this.settings.get('enabledLaunchers'))
    const errors: SourceError[] = []
    const detected: DetectedGame[] = []
    const scanned = new Map<GameSourceId, Set<string>>()

    if (options.includeLaunchers !== false) {
      const results = await Promise.allSettled(
        this.sources
          .filter((s) => enabled.has(s.id))
          .map(async (source) => ({ source, games: await source.scan() }))
      )
      results.forEach((result, index) => {
        const source = this.sources.filter((s) => enabled.has(s.id))[index]!
        if (result.status === 'fulfilled') {
          detected.push(...result.value.games)
          scanned.set(source.id, new Set(result.value.games.map((g) => g.sourceId)))
        } else {
          const reason =
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          errors.push({ source: source.id, message: `${source.name} : ${reason}` })
        }
      })
    }

    const folders = options.folders ?? this.settings.get('scanFolders')
    const exclusions = this.settings.get('extraExclusions')
    const findings: FolderFinding[] = []
    for (const folder of folders) {
      try {
        findings.push(...(await scanFolder(folder, exclusions)))
      } catch (error) {
        errors.push({
          source: 'manual',
          message: `${folder} : ${error instanceof Error ? error.message : String(error)}`
        })
      }
    }

    const existing = this.db.select().from(games).all()
    const candidates = buildCandidates(detected, findings, existing)
    this.lastScan = { candidates: new Map(candidates.map((c) => [c.key, c])), scanned }
    return { candidates, launchers: await this.launchers(), errors }
  }

  apply(decisions: ImportDecision[]): ImportReport {
    const scan = this.lastScan
    if (!scan) throw new AppError('VALIDATION', 'Lancez d’abord une détection.')
    const report: ImportReport = {
      imported: 0,
      updated: 0,
      merged: 0,
      ignored: 0,
      markedNotInstalled: 0
    }
    const touched: ImportedGame[] = []
    const decided = new Map(decisions.map((d) => [d.key, d]))

    this.db.transaction((tx) => {
      for (const candidate of scan.candidates.values()) {
        // Launcher games already known are refreshed even without an explicit decision.
        const decision =
          decided.get(candidate.key) ??
          (candidate.status === 'update' ? { key: candidate.key, action: 'import' as const } : null)
        if (!decision || decision.action === 'ignore') {
          if (decision) report.ignored++
          continue
        }
        const igdbId = decision.igdbId ?? null

        if (decision.action === 'merge') {
          if (!candidate.duplicateOf) continue
          const target = tx.select().from(games).where(eq(games.id, candidate.duplicateOf.id)).get()
          if (!target) continue
          tx.update(games)
            .set({
              installState: 'installed',
              installPath: target.installPath ?? candidate.installPath,
              executablePath: target.executablePath ?? candidate.executablePath
            })
            .where(eq(games.id, target.id))
            .run()
          report.merged++
          touched.push({ id: target.id, igdbId: decision.igdbId })
          continue
        }

        if (candidate.source === 'manual') {
          const row = tx
            .insert(games)
            .values({
              title: decision.title?.trim() || candidate.title,
              source: 'manual',
              sourceId: randomUUID(),
              ownership: 'manual',
              installState: 'installed',
              installPath: candidate.installPath,
              executablePath: candidate.executablePath,
              igdbId
            })
            .returning()
            .get()
          report.imported++
          touched.push({ id: row.id, igdbId: decision.igdbId })
          continue
        }

        const row = tx
          .insert(games)
          .values({
            title: decision.title?.trim() || candidate.title,
            source: candidate.source,
            sourceId: candidate.sourceId,
            ownership: 'owned',
            installState: 'installed',
            installPath: candidate.installPath,
            executablePath: candidate.executablePath,
            igdbId
          })
          .onConflictDoUpdate({
            target: [games.source, games.sourceId],
            set: {
              installState: 'installed',
              ownership: 'owned',
              installPath: candidate.installPath,
              ...(candidate.executablePath ? { executablePath: candidate.executablePath } : {})
            }
          })
          .returning()
          .get()
        if (candidate.status === 'update') report.updated++
        else report.imported++
        touched.push({
          id: row.id,
          igdbId: decision.igdbId !== undefined ? decision.igdbId : (row.igdbId ?? undefined)
        })
      }

      // Launcher games that disappeared from a successful scan are no longer installed,
      // unless a known executable is still on disk (e.g. a DRM-free copy merged in).
      for (const [source, ids] of scan.scanned) {
        const gone = tx
          .select({ id: games.id, executablePath: games.executablePath })
          .from(games)
          .where(
            and(
              eq(games.source, source),
              eq(games.installState, 'installed'),
              ids.size ? notInArray(games.sourceId, [...ids]) : undefined
            )
          )
          .all()
          .filter((g) => !g.executablePath || !existsSync(g.executablePath))
        if (gone.length === 0) continue
        tx.update(games)
          .set({ installState: 'not_installed' })
          .where(
            inArray(
              games.id,
              gone.map((g) => g.id)
            )
          )
          .run()
        report.markedNotInstalled += gone.length
      }
    })

    this.lastScan = null
    this.onImported(touched)
    return report
  }

  /** Re-runs launcher detection and refreshes known games silently (startup). */
  async refreshInstalled(): Promise<ImportReport | null> {
    const known = this.db
      .select({ source: games.source })
      .from(games)
      .where(inArray(games.source, ['steam', 'epic', 'gog', 'itch']))
      .all()
    if (known.length === 0) return null
    const result = await this.scan({ folders: [] })
    const updates = result.candidates.filter((c) => c.status === 'update')
    return this.apply(updates.map((c) => ({ key: c.key, action: 'import' })))
  }
}
