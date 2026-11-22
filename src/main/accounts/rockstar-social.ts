import { AppError } from '../../shared/errors'
import { rockstarTitleByTag } from '../../shared/rockstar'
import { requestJson, type FetchLike, type HttpOptions } from '../net/http'
import type { AccountProvider, OwnedGame } from './types'

// Rockstar Games Social Club (unofficial, chosen by the user over a catalogue to tick): the
// launcher keeps the owned titles encrypted, the Social Club website tells them through
// `getGoogleTagManagerSetupData`, whose `gamesOwned` lists the account's games
// ("GTAV_PC|RDR2_PC|Launcher_PC"), as read by the GOG Galaxy integration.
//
// Rockstar merged its sites: socialclub.rockstargames.com now redirects to
// www.rockstargames.com, where the user signs in. The Social Club API then answers 401 until
// its own session is opened by `/Blocker/AuthCheck`, a chain of redirects through
// signin.rockstargames.com that sets the Social Club cookies. Cookies across three hosts and
// redirects: the requests run in an isolated Electron session (`rockstar-browser.ts`), which
// keeps them like a browser would; between syncs they are kept encrypted by SecretStore.
//
// Observed 2026-11-22 with a signed-in account: once the Social Club session is open,
// `getGoogleTagManagerSetupData` answers 403 `{ Status, EmailVerified, ProfileHidden,
// WallHidden, NotAllowed }`: the former website route is closed. The games are read first
// from the account's profile on scapi (`getbasicprofile` for the nickname, then `getprofile`,
// with the `BearerToken` cookie AuthCheck sets on `.socialclub.rockstargames.com`); the
// website's route stays as a fallback.
// Isolated in this module: if Rockstar changes it, only this account fails (`lastError`).

export const SOCIAL_CLUB_URL = 'https://socialclub.rockstargames.com/'
export const AUTH_CHECK_URL = 'https://socialclub.rockstargames.com/Blocker/AuthCheck'
const SETUP_DATA_URL = 'https://socialclub.rockstargames.com/ajax/getGoogleTagManagerSetupData'
const BASIC_PROFILE_URL = 'https://scapi.rockstargames.com/profile/getbasicprofile'
const PROFILE_URL = 'https://scapi.rockstargames.com/profile/getprofile'

const EXPIRED = 'Session Rockstar expirée : reconnectez le compte Social Club.'
const NO_LIST =
  'Connecté à Social Club, mais Rockstar ne fournit plus la liste des jeux de ce compte.'

/** A cookie of the Rockstar session, as Electron reports it (replayed as is). */
export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate?: number
}

/** What the login window hands over, and what is kept (JSON) in SecretStore. */
export interface SocialClubSession {
  cookies: StoredCookie[]
  /** User-Agent of the login window: the website sees the same browser afterwards. */
  userAgent: string
}

export function parseSession(secret: string | null): SocialClubSession {
  try {
    const data = JSON.parse(secret ?? '') as Partial<SocialClubSession>
    if (Array.isArray(data.cookies) && data.cookies.length && typeof data.userAgent === 'string') {
      return { cookies: data.cookies, userAgent: data.userAgent }
    }
  } catch {
    // Unreadable: reconnect.
  }
  throw new AppError('AUTH', 'Session Rockstar absente : reconnectez le compte Social Club.')
}

/** Requests in the Rockstar session (its cookies sent and kept), and how to open Social Club's. */
export interface SocialClubAccess {
  fetch: FetchLike
  /** Opens the Social Club session from the rockstargames.com sign-in (`/Blocker/AuthCheck`). */
  authCheck: () => Promise<void>
  /** Cookies of the session now (the bearer token changes after `authCheck`). */
  cookies: () => Promise<StoredCookie[]>
}

interface SetupData {
  loginState?: string | boolean
  gamesOwned?: string | string[] | null
}

/** PC games of `gamesOwned` known to the catalogue; the launcher itself and consoles left out. */
export function parseGamesOwned(data: SetupData): OwnedGame[] {
  const raw = data.gamesOwned
  const tags = (Array.isArray(raw) ? raw : (raw ?? '').split('|')).map((t) => String(t).trim())
  const owned = new Map<string, OwnedGame>()
  for (const tag of tags) {
    if (!/_PC$/i.test(tag) || /^launcher_pc$/i.test(tag)) continue
    const title = rockstarTitleByTag(tag)
    if (title && !owned.has(title.titleId)) {
      owned.set(title.titleId, { source: 'rockstar', sourceId: title.titleId, title: title.title })
    }
  }
  return [...owned.values()]
}

const options = (access: SocialClubAccess): HttpOptions => ({
  service: 'Rockstar Games Social Club',
  fetch: access.fetch
})

const isAuth = (error: unknown): boolean => error instanceof AppError && error.code === 'AUTH'

async function setupData(access: SocialClubAccess, now: number): Promise<SetupData> {
  const data = await requestJson<SetupData>(
    `${SETUP_DATA_URL}?_=${now}`,
    {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: SOCIAL_CLUB_URL
      }
    },
    options(access)
  ).catch((error: unknown) => {
    // Signed out, the website answers with its sign-in page instead of JSON.
    if (error instanceof AppError && error.code === 'NETWORK' && /illisible/.test(error.message)) {
      throw new AppError('AUTH', EXPIRED)
    }
    throw error
  })
  if (String(data.loginState).toLowerCase() === 'false') throw new AppError('AUTH', EXPIRED)
  return data
}

/** Social Club's own token first (set by `/Blocker/AuthCheck`), else the website's. */
export function bearerOf(cookies: StoredCookie[]): string | null {
  const tokens = cookies.filter((c) => c.name === 'BearerToken' && c.value)
  return (tokens.find((c) => /socialclub/i.test(c.domain)) ?? tokens[0])?.value ?? null
}

const scapi = <T>(access: SocialClubAccess, url: string, bearer: string): Promise<T> =>
  requestJson<T>(
    url,
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json'
      }
    },
    options(access)
  )

interface Profile {
  displayName: string
  rockstarId: string
}

async function basicProfile(access: SocialClubAccess, bearer: string): Promise<Profile | null> {
  const data = await scapi<{
    accounts?: { rockstarAccount?: { displayName?: string; rockstarId?: number | string } }[]
  }>(access, BASIC_PROFILE_URL, bearer)
  const account = data.accounts?.[0]?.rockstarAccount
  if (!account?.displayName || account.rockstarId === undefined) return null
  return { displayName: account.displayName, rockstarId: String(account.rockstarId) }
}

/** Nickname and Rockstar id, with the short-lived bearer token Social Club sets. */
export async function readProfile(
  access: SocialClubAccess,
  cookies: StoredCookie[]
): Promise<Profile | null> {
  const bearer = bearerOf(cookies)
  return bearer ? basicProfile(access, bearer) : null
}

/** First `gamesOwned` array of a profile, wherever it is nested; null when there is none. */
function findGamesOwned(data: unknown, depth = 0): unknown[] | null {
  if (!data || typeof data !== 'object' || depth > 4) return null
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findGamesOwned(item, depth + 1)
      if (found) return found
    }
    return null
  }
  for (const [key, value] of Object.entries(data)) {
    if (/^gamesOwned$/i.test(key) && Array.isArray(value)) return value
  }
  for (const value of Object.values(data)) {
    const found = findGamesOwned(value, depth + 1)
    if (found) return found
  }
  return null
}

/**
 * Social Club tags of a profile's `gamesOwned`: "GTAV_PC" as is, or `{ name: "GTAV",
 * platform: "PC" | "PCROS" }` turned into "GTAV_PC" (consoles keep their platform, so
 * `parseGamesOwned` drops them).
 */
export function profileTags(gamesOwned: unknown[]): string[] {
  const tags: string[] = []
  for (const item of gamesOwned) {
    if (typeof item === 'string') {
      tags.push(item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const g = item as Record<string, unknown>
    const name = [g.name, g.title, g.titleName, g.game].find(
      (v): v is string => typeof v === 'string' && v.length > 0
    )
    if (!name) continue
    const platform = typeof g.platform === 'string' ? g.platform : 'PC'
    tags.push(/_/.test(name) ? name : `${name}_${/^pc/i.test(platform) ? 'PC' : platform}`)
  }
  return tags
}

/**
 * Games of the account from its Social Club profile (scapi, bearer token): the nickname from
 * `getbasicprofile`, then `getprofile`. Null when the profile carries no games list.
 */
async function profileGames(access: SocialClubAccess): Promise<OwnedGame[] | null> {
  const bearer = bearerOf(await access.cookies())
  // No token: the Social Club session is not open yet.
  if (!bearer) throw new AppError('AUTH', EXPIRED)
  const profile = await basicProfile(access, bearer)
  if (!profile) return null
  const data = await scapi<unknown>(
    access,
    `${PROFILE_URL}?nickname=${encodeURIComponent(profile.displayName)}&maxFriends=0`,
    bearer
  )
  const owned = findGamesOwned(data)
  return owned ? parseGamesOwned({ gamesOwned: profileTags(owned) }) : null
}

/** One read: the profile first, the website's former `gamesOwned` when it has no list. */
async function attempt(access: SocialClubAccess, now: number): Promise<OwnedGame[]> {
  let signedIn = false
  try {
    const games = await profileGames(access)
    if (games) return games
    signedIn = true
  } catch (error) {
    if (!isAuth(error)) throw error
  }
  try {
    return parseGamesOwned(await setupData(access, now))
  } catch (error) {
    // Signed in (profile read), but no list anywhere: say so rather than "expired".
    if (signedIn && isAuth(error)) throw new AppError('UNAVAILABLE', NO_LIST)
    throw error
  }
}

/**
 * Games of the signed-in account. Refused means the Social Club session is not open (first
 * read after the sign-in, or expired token): `/Blocker/AuthCheck` opens it from the
 * rockstargames.com sign-in (new `BearerToken`), then one more try. Still refused: signed out.
 */
export async function readOwned(access: SocialClubAccess, now = Date.now()): Promise<OwnedGame[]> {
  try {
    return await attempt(access, now)
  } catch (error) {
    if (!isAuth(error)) throw error
  }
  await access.authCheck()
  try {
    return await attempt(access, now)
  } catch (error) {
    if (isAuth(error)) throw new AppError('AUTH', EXPIRED)
    throw error
  }
}

/** The browser side (Electron sessions), injected: the provider stays testable. */
export interface SocialClubBrowser {
  /**
   * Opens the login window; `probe` is tried as the user browses (and when the window is
   * closed) until it succeeds. Resolves with the session and the probe's result.
   */
  login<T>(
    probe: (access: SocialClubAccess) => Promise<T>
  ): Promise<{ session: SocialClubSession; result: T }>
  /** Runs `fn` with a saved session loaded; resolves with its result and the renewed session. */
  use<T>(
    session: SocialClubSession,
    fn: (access: SocialClubAccess) => Promise<T>
  ): Promise<{ session: SocialClubSession; result: T }>
}

export interface RockstarSocialDeps {
  browser: SocialClubBrowser
  now?: () => number
}

export function rockstarSocialProvider(deps: RockstarSocialDeps): AccountProvider<unknown> {
  return {
    kind: 'rockstar-social',
    source: 'rockstar',
    async connect() {
      const { session, result: profile } = await deps.browser.login(async (access) => {
        await readOwned(access, deps.now?.())
        return readProfile(access, await access.cookies()).catch(() => null)
      })
      return {
        displayName: profile?.displayName ?? 'Compte Rockstar',
        externalUserId: profile?.rockstarId ?? 'social-club',
        secret: JSON.stringify(session)
      }
    },
    async fetchOwned(_account, secret) {
      const { session, result } = await deps.browser.use(parseSession(secret), (access) =>
        readOwned(access, deps.now?.())
      )
      return { games: result, secret: JSON.stringify(session) }
    }
  }
}
