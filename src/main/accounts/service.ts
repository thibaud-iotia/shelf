import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { GameSourceId } from '../../shared/domain'
import { AppError, toSerializedError } from '../../shared/errors'
import type { Account, AccountKind, ConnectInput, SyncReport } from '../../shared/models'
import { ACCOUNT_KINDS } from '../../shared/models'
import type { ShelfDatabase } from '../db/client'
import { accounts, gameDlcs, games } from '../db/schema'
import type { SecretStore } from '../secrets/store'
import type { AccountProvider, OwnedGame } from './types'

export const SYNC_MAX_AGE_MS = 24 * 3600_000

type AccountRow = typeof accounts.$inferSelect

/**
 * Inserts owned games as "not installed" and refreshes the ones already known through
 * local detection: same (source, sourceId) → one row, owned + installed.
 * Add-ons are attached to their base game (`game_dlcs`), never listed as games; an add-on
 * whose base game is unknown is dropped like any unlisted entry. Rows an earlier sync
 * imported for them as games are removed, unless the user installed or set them up.
 */
export function upsertOwned(
  db: ShelfDatabase,
  owned: OwnedGame[],
  now: Date
): { added: number; updated: number; dlcs: number } {
  let added = 0
  let updated = 0
  let dlcs = 0
  db.transaction((tx) => {
    for (const source of new Set(owned.map((g) => g.source))) {
      const entries = owned.filter((g) => g.source === source)
      const listed = entries.filter((g) => !g.unlisted && g.dlcOf === undefined)
      const ids = listed.map((g) => g.sourceId)
      const known = new Set<string>()
      for (let i = 0; i < ids.length; i += 500) {
        tx.select({ sourceId: games.sourceId })
          .from(games)
          .where(and(eq(games.source, source), inArray(games.sourceId, ids.slice(i, i + 500))))
          .all()
          .forEach((r) => known.add(r.sourceId))
      }
      for (const game of listed) {
        const playtime = game.playtimeMin ?? null
        tx.insert(games)
          .values({
            title: game.title,
            source: game.source,
            sourceId: game.sourceId,
            ownership: 'owned',
            installState: 'not_installed',
            externalPlaytimeMin: playtime,
            lastSyncedAt: now
          })
          .onConflictDoUpdate({
            target: [games.source, games.sourceId],
            set: {
              ownership: 'owned',
              lastSyncedAt: now,
              installState: sql`CASE WHEN ${games.installState} = 'unknown' THEN 'not_installed' ELSE ${games.installState} END`,
              ...(playtime !== null ? { externalPlaytimeMin: playtime } : {})
            }
          })
          .run()
        if (known.has(game.sourceId)) updated++
        else added++
      }

      const baseIds = new Map<string, number>()
      const baseOf = (sourceId: string) => {
        if (!baseIds.has(sourceId)) {
          const row = tx
            .select({ id: games.id })
            .from(games)
            .where(and(eq(games.source, source), eq(games.sourceId, sourceId)))
            .get()
          baseIds.set(sourceId, row?.id ?? 0)
        }
        return baseIds.get(sourceId) || null
      }
      const notGames = entries.filter((g) => g.unlisted || g.dlcOf !== undefined)
      for (const entry of notGames) {
        const gameId = !entry.unlisted && entry.dlcOf ? baseOf(entry.dlcOf) : null
        if (gameId && entry.dlcOf !== entry.sourceId) {
          tx.insert(gameDlcs)
            .values({ gameId, source, sourceId: entry.sourceId, title: entry.title })
            .onConflictDoUpdate({
              target: [gameDlcs.source, gameDlcs.sourceId],
              set: { gameId, title: entry.title }
            })
            .run()
          dlcs++
        }
      }
      const stale = notGames.map((g) => g.sourceId)
      for (let i = 0; i < stale.length; i += 500) {
        tx.delete(games)
          .where(
            and(
              eq(games.source, source),
              inArray(games.sourceId, stale.slice(i, i + 500)),
              ne(games.installState, 'installed'),
              isNull(games.executablePath)
            )
          )
          .run()
      }
    }
  })
  return { added, updated, dlcs }
}

export class AccountService {
  private readonly providers: Map<AccountKind, AccountProvider>

  constructor(
    private readonly db: ShelfDatabase,
    private readonly secrets: SecretStore,
    providers: AccountProvider[],
    private readonly options: {
      isEnabled?: (kind: AccountKind) => boolean
      now?: () => Date
    } = {}
  ) {
    this.providers = new Map(providers.map((p) => [p.kind, p]))
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private provider(kind: AccountKind): AccountProvider {
    const provider = this.providers.get(kind)
    if (!provider || !(this.options.isEnabled?.(kind) ?? true)) {
      throw new AppError('UNAVAILABLE', 'Ce type de compte n’est pas activé.')
    }
    return provider
  }

  private toAccount(row: AccountRow): Account {
    const count = this.db
      .select({ n: sql<number>`count(*)` })
      .from(games)
      .where(and(eq(games.source, row.source), eq(games.ownership, 'owned')))
      .get()
    return {
      id: row.id,
      kind: row.kind,
      source: row.source,
      displayName: row.displayName,
      externalUserId: row.externalUserId,
      lastSyncAt: row.lastSyncAt?.getTime() ?? null,
      lastError: row.lastError,
      gameCount: count?.n ?? 0
    }
  }

  list(): Account[] {
    return this.db
      .select()
      .from(accounts)
      .orderBy(accounts.kind)
      .all()
      .map((r) => this.toAccount(r))
  }

  private row(id: string): AccountRow {
    const row = this.db.select().from(accounts).where(eq(accounts.id, id)).get()
    if (!row) throw new AppError('NOT_FOUND', 'Ce compte n’est plus connecté.')
    return row
  }

  async connect(input: ConnectInput): Promise<{ account: Account; sync: SyncReport }> {
    if (!input || !(ACCOUNT_KINDS as readonly string[]).includes(input.kind)) {
      throw new AppError('VALIDATION', 'Type de compte inconnu.')
    }
    const provider = this.provider(input.kind)
    const connected = await provider.connect(input)
    const id = `${input.kind}:${connected.externalUserId}`
    const credentialsRef = connected.secret ? `account:${id}` : null
    if (connected.secret && credentialsRef) this.secrets.set(credentialsRef, connected.secret)

    this.db
      .insert(accounts)
      .values({
        id,
        kind: input.kind,
        source: provider.source,
        displayName: connected.displayName,
        externalUserId: connected.externalUserId,
        credentialsRef,
        lastError: null
      })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { displayName: connected.displayName, credentialsRef, lastError: null }
      })
      .run()

    const sync = await this.sync(id)
    return { account: this.toAccount(this.row(id)), sync }
  }

  disconnect(id: string): void {
    const row = this.row(id)
    if (row.credentialsRef) this.secrets.delete(row.credentialsRef)
    this.db.delete(accounts).where(eq(accounts.id, id)).run()
  }

  /** Never throws: errors are stored on the account and returned in the report. */
  async sync(id: string): Promise<SyncReport> {
    const row = this.row(id)
    try {
      const provider = this.provider(row.kind)
      const secret = row.credentialsRef ? this.secrets.get(row.credentialsRef) : null
      const result = await provider.fetchOwned(row, secret)
      if (result.secret && row.credentialsRef) this.secrets.set(row.credentialsRef, result.secret)
      const now = this.now()
      const { added, updated } = upsertOwned(this.db, result.games, now)
      this.db
        .update(accounts)
        .set({ lastSyncAt: now, lastError: null })
        .where(eq(accounts.id, id))
        .run()
      const total = result.games.filter((g) => !g.unlisted && g.dlcOf === undefined).length
      return { accountId: id, added, updated, total, error: null }
    } catch (error) {
      const message = toSerializedError(error).message
      this.db.update(accounts).set({ lastError: message }).where(eq(accounts.id, id)).run()
      return { accountId: id, added: 0, updated: 0, total: 0, error: message }
    }
  }

  /** Local accounts, and the others never synced or synced more than `maxAgeMs` ago. */
  async syncDue(maxAgeMs = SYNC_MAX_AGE_MS): Promise<SyncReport[]> {
    const limit = this.now().getTime() - maxAgeMs
    const due = this.db
      .select()
      .from(accounts)
      .all()
      .filter(
        (a) => this.providers.get(a.kind)?.local || !a.lastSyncAt || a.lastSyncAt.getTime() < limit
      )
    const reports: SyncReport[] = []
    for (const account of due) reports.push(await this.sync(account.id))
    return reports
  }

  /** Accounts of one launcher (Steam after a game session, to fetch its new playtime). */
  async syncSource(source: GameSourceId): Promise<SyncReport[]> {
    const rows = this.db.select().from(accounts).where(eq(accounts.source, source)).all()
    const reports: SyncReport[] = []
    for (const account of rows) reports.push(await this.sync(account.id))
    return reports
  }

  async syncAll(): Promise<SyncReport[]> {
    return this.syncDue(-1)
  }
}
