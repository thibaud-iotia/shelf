import type { GameSourceId } from '../../shared/domain'
import type { AccountKind } from '../../shared/models'
import type { FetchLike } from '../net/http'

/** A game owned on a launcher account, installed or not. */
export interface OwnedGame {
  source: GameSourceId
  sourceId: string
  title: string
  /** Launcher-side playtime (Steam `playtime_forever`), when the API exposes it. */
  playtimeMin?: number | null
}

export interface ConnectedAccount {
  displayName: string
  externalUserId: string
  /** Secret to keep through safeStorage (API key, refresh token…), if any. */
  secret: string | null
}

export interface ProviderDeps {
  fetch?: FetchLike
}

/**
 * Synchronisation side of a launcher (PLAN: AccountSource). Install URIs live in
 * `sources/uris.ts`, shared with launching.
 */
export interface AccountProvider<I = unknown> {
  kind: AccountKind
  source: GameSourceId
  connect(input: I): Promise<ConnectedAccount>
  /** May return a rotated secret (OAuth refresh) to store instead of the old one. */
  fetchOwned(
    account: { externalUserId: string },
    secret: string | null
  ): Promise<{ games: OwnedGame[]; secret?: string }>
}
