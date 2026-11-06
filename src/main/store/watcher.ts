import type { GameSourceId } from '../../shared/domain'

export interface PendingPurchase {
  title: string
  steamAppId: string | null
  /** Launcher whose account should list the game; null = unknown store (sync them all). */
  source: GameSourceId | null
}

export interface PurchaseWatcherDeps {
  /** Syncs the accounts of these launchers (null: all) and re-reads the launchers' files. */
  refresh: (sources: (GameSourceId | null)[]) => Promise<void>
  /** Library game matching the purchase, if any. */
  findOwned: (purchase: PendingPurchase) => number | null
  onPurchased: (purchase: PendingPurchase, gameId: number) => void
  now?: () => number
  /** Background check while purchases are pending. */
  intervalMs?: number
  /** A purchase not seen after this long is forgotten. */
  maxAgeMs?: number
  /** Window focus checks closer than this are skipped. */
  minGapMs?: number
}

const key = (p: PendingPurchase) => p.steamAppId ?? p.title.toLowerCase()

/**
 * Purchases opened from the store, followed until the game shows up in the library. Payment
 * happens in the launcher's window; when the user comes back to Shelf (window focus) or every
 * `intervalMs`, the accounts are synced and the library searched.
 */
export class PurchaseWatcher {
  private readonly pending = new Map<string, PendingPurchase & { startedAt: number }>()
  private timer: NodeJS.Timeout | null = null
  private lastCheck = 0
  private checking: Promise<void> | null = null
  private readonly now: () => number

  constructor(private readonly deps: PurchaseWatcherDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Starts following a purchase; returns false when the game is already in the library. */
  add(purchase: PendingPurchase): boolean {
    if (this.deps.findOwned(purchase) !== null) return false
    this.pending.set(key(purchase), { ...purchase, startedAt: this.now() })
    this.timer ??= setInterval(() => void this.check(), this.deps.intervalMs ?? 120_000)
    this.timer.unref?.()
    return true
  }

  pendingCount(): number {
    return this.pending.size
  }

  /** The user is back in Shelf: check now, unless a check just ran. */
  nudge(): void {
    if (!this.pending.size) return
    if (this.now() - this.lastCheck < (this.deps.minGapMs ?? 15_000)) return
    void this.check()
  }

  check(): Promise<void> {
    return (this.checking ??= this.run().finally(() => {
      this.checking = null
    }))
  }

  private async run(): Promise<void> {
    this.lastCheck = this.now()
    const maxAge = this.deps.maxAgeMs ?? 2 * 3600_000
    for (const [k, p] of this.pending) {
      if (this.now() - p.startedAt > maxAge) this.pending.delete(k)
    }
    if (!this.pending.size) return this.stop()
    try {
      await this.deps.refresh([...new Set([...this.pending.values()].map((p) => p.source))])
    } catch (error) {
      console.warn('[store] purchase check: refresh failed', error)
    }
    for (const [k, p] of this.pending) {
      const gameId = this.deps.findOwned(p)
      if (gameId === null) continue
      this.pending.delete(k)
      this.deps.onPurchased({ title: p.title, steamAppId: p.steamAppId, source: p.source }, gameId)
    }
    if (!this.pending.size) this.stop()
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
    this.pending.clear()
  }
}
