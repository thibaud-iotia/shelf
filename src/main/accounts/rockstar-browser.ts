import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BrowserWindow, session, type Session } from 'electron'
import { AppError } from '../../shared/errors'
import type { FetchLike } from '../net/http'
import {
  AUTH_CHECK_URL,
  SOCIAL_CLUB_URL,
  type SocialClubAccess,
  type SocialClubBrowser,
  type SocialClubSession,
  type StoredCookie
} from './rockstar-social'

// Electron side of the Social Club account: the login window, and the isolated sessions the
// requests run in (cookies across rockstargames.com, signin. and socialclub., redirects, and
// the JavaScript of `/Blocker/AuthCheck` if it needs any). Both sessions are in memory and
// emptied after use: between syncs, the cookies only live encrypted in SecretStore.

const ROCKSTAR_HOST = /(^|\.)rockstargames\.com$/i
/** Rockstar's script CDN, the only other host `/Blocker/AuthCheck` may need. */
const ROCKSTAR_SCRIPTS = /^media-rockstargames-com\.akamaized\.net$/i
const SIGNIN_HOST = /^signin\.rockstargames\.com$/i
const AUTH_CHECK_TIMEOUT_MS = 20_000
/** Quiet time after the last navigation of `/Blocker/AuthCheck` before it counts as done. */
const AUTH_CHECK_SETTLE_MS = 1_500
const PROBE_DELAY_MS = 1_500

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Origin and path only: never a query string (codes, tokens) in the diagnostics. */
const safeUrl = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return '?'
  }
}

/** Plain Chrome User-Agent: without the "Electron/…" and "Shelf/…" tokens sites may refuse. */
function browserUserAgent(ses: Session): string {
  return ses.getUserAgent().replace(/\s(?:Electron|shelf|Shelf)\/\S+/g, '')
}

function sessionFetch(ses: Session): FetchLike {
  return (url, init) =>
    ses.fetch(url, { ...init, credentials: 'include' }) as unknown as Promise<Response>
}

/** Strings shown in the diagnostics: game tags and error codes, never names or ids. */
const GAME_FIELD = /^(name|title|titleName|game|platform)$/i
const ERROR_FIELD = /^(code|message|status)$/i

/**
 * Shape of a JSON value without personal data: keys, types, booleans, array sizes; strings
 * only for the games of an array whose key speaks of games, and for error codes.
 */
function shape(value: unknown, key = '', inGames = false, depth = 0): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const games = inGames || /game/i.test(key)
    const shown = value.slice(0, games ? 30 : 1).map((v) => shape(v, key, games, depth + 1))
    return `[${value.length}${shown.length ? ` ${shown.join(' ')}` : ''}]`
  }
  if (typeof value === 'object') {
    if (depth >= 4) return '{…}'
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30)
    return `{${entries.map(([k, v]) => `${k}:${shape(v, k, inGames, depth + 1)}`).join(', ')}}`
  }
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    const visible =
      (inGames && (GAME_FIELD.test(key) || /game/i.test(key))) ||
      (ERROR_FIELD.test(key) && value.length <= 120)
    return visible ? JSON.stringify(value) : 'texte'
  }
  return typeof value
}

/** What a response says without any personal data: page title, JSON shape, or a short text. */
function describeBody(text: string, type: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (/html/i.test(type) || /^<!doctype|^<html/i.test(flat)) {
    return `page HTML « ${/<title[^>]*>([^<]*)</i.exec(flat)?.[1]?.trim() ?? '?'} »`
  }
  try {
    return `JSON ${shape(JSON.parse(text))}`
  } catch {
    return flat ? `texte « ${flat.slice(0, 160)} »` : '(vide)'
  }
}

/** Requests of the session, with their outcome in the diagnostics. */
function loggedFetch(ses: Session, diag: Diagnostics): FetchLike {
  const fetch = sessionFetch(ses)
  return async (url, init) => {
    try {
      const res = await fetch(url, init)
      const type = res.headers.get('content-type') ?? '?'
      const moved = res.redirected ? `, redirigée vers ${safeUrl(res.url)}` : ''
      const body = describeBody(await res.clone().text(), type)
      diag.log(`requête ${safeUrl(url)} : HTTP ${res.status} ${type}${moved} — ${body}`)
      return res
    } catch (error) {
      diag.log(`requête ${safeUrl(url)} : échec ${String(error)}`)
      throw error
    }
  }
}

async function exportCookies(ses: Session): Promise<StoredCookie[]> {
  const cookies = await ses.cookies.get({})
  return cookies
    .filter((c) => ROCKSTAR_HOST.test((c.domain ?? '').replace(/^\./, '')))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '',
      path: c.path ?? '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      hostOnly: c.hostOnly,
      sameSite: c.sameSite,
      ...(c.expirationDate ? { expirationDate: c.expirationDate } : {})
    }))
}

async function importCookies(ses: Session, cookies: StoredCookie[]): Promise<void> {
  for (const c of cookies) {
    const host = c.domain.replace(/^\./, '')
    if (!ROCKSTAR_HOST.test(host)) continue
    await ses.cookies
      .set({
        url: `https://${host}${c.path || '/'}`,
        name: c.name,
        value: c.value,
        ...(c.hostOnly ? {} : { domain: c.domain }),
        path: c.path || '/',
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
        ...(c.sameSite ? { sameSite: c.sameSite } : {}),
        ...(c.expirationDate ? { expirationDate: c.expirationDate } : {})
      })
      .catch(() => {
        // A cookie Chromium refuses (expired…): the others still go.
      })
  }
}

/** Diagnostics of the last login and sync: URLs without queries, cookie names, outcomes. */
class Diagnostics {
  constructor(private readonly file: string | null) {}

  reset(title: string): void {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, `${new Date().toISOString()} ${title}\n`)
    } catch {
      // Diagnostics never break the login.
    }
  }

  log(line: string): void {
    if (!this.file) return
    try {
      appendFileSync(this.file, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // Same.
    }
  }

  async cookies(ses: Session, label: string): Promise<void> {
    const names = (await exportCookies(ses)).map((c) => `${c.name}@${c.domain}`)
    this.log(`${label} cookies: ${names.join(', ') || '(aucun)'}`)
  }
}

/**
 * Opens the Social Club session: `/Blocker/AuthCheck` in a hidden window of the same session,
 * so its redirects (and scripts, if any) run like in a browser.
 */
function authCheck(ses: Session, diag: Diagnostics): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    let settleTimer: NodeJS.Timeout | null = null
    const done = () => {
      if (settleTimer) clearTimeout(settleTimer)
      clearTimeout(timeout)
      if (!win.isDestroyed()) win.destroy()
      resolve()
    }
    const timeout = setTimeout(() => {
      diag.log('authCheck: délai dépassé')
      done()
    }, AUTH_CHECK_TIMEOUT_MS)
    const quiet = () => {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(done, AUTH_CHECK_SETTLE_MS)
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('did-redirect-navigation', (_e, url) =>
      diag.log(`authCheck → ${safeUrl(url)}`)
    )
    win.webContents.on('did-navigate', (_e, url, code) =>
      diag.log(`authCheck page ${safeUrl(url)} (HTTP ${code})`)
    )
    win.webContents.on('did-stop-loading', quiet)
    win.webContents.on('did-fail-load', (_e, code, description, url) => {
      diag.log(`authCheck échec ${safeUrl(url)} : ${code} ${description}`)
      quiet()
    })
    void win.loadURL(AUTH_CHECK_URL).catch(() => quiet())
  })
}

function access(ses: Session, diag: Diagnostics): SocialClubAccess {
  return {
    fetch: loggedFetch(ses, diag),
    authCheck: async () => {
      await authCheck(ses, diag)
      await diag.cookies(ses, 'après authCheck')
    },
    cookies: () => exportCookies(ses)
  }
}

/** Requests of the sync session: Rockstar hosts only, documents, scripts and calls only. */
function guard(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const host = hostOf(details.url)
    const allowed =
      ROCKSTAR_HOST.test(host) || (details.resourceType === 'script' && ROCKSTAR_SCRIPTS.test(host))
    const heavy = ['image', 'media', 'font', 'stylesheet'].includes(details.resourceType)
    callback({ cancel: !allowed || heavy })
  })
}

export function rockstarBrowser(options: {
  parent: () => BrowserWindow | undefined
  /** Diagnostics file (userData), null: none. */
  logFile: string | null
}): SocialClubBrowser {
  const diag = new Diagnostics(options.logFile)
  let guarded = false
  let queue: Promise<unknown> = Promise.resolve()

  return {
    login(probe) {
      const ses = session.fromPartition('rockstar-login')
      diag.reset('Connexion Social Club')
      return new Promise((resolve, reject) => {
        const parent = options.parent()
        const win = new BrowserWindow({
          parent,
          modal: !!parent,
          width: 520,
          height: 780,
          title: 'Connexion à Rockstar Games',
          autoHideMenuBar: true,
          webPreferences: {
            session: ses,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        })
        let settled = false
        let sawSignin = false
        let probing: Promise<boolean> | null = null
        let timer: NodeJS.Timeout | null = null
        let lastError: string | null = null

        const finish = async (outcome: { result: unknown } | { error: AppError }) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          if ('result' in outcome) {
            const cookies = await exportCookies(ses)
            resolve({
              session: { cookies, userAgent: browserUserAgent(ses) },
              result: outcome.result as never
            })
          } else {
            reject(outcome.error)
          }
          if (!win.isDestroyed()) win.close()
          void ses.clearStorageData()
        }

        /** True once the probe succeeded (the login is then over). */
        const runProbe = (why: string): Promise<boolean> =>
          (probing ??= (async () => {
            diag.log(`essai (${why})`)
            await diag.cookies(ses, 'avant essai')
            try {
              const result = await probe(access(ses, diag))
              diag.log('essai réussi : jeux Social Club lus')
              await finish({ result })
              return true
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error)
              diag.log(`essai refusé : ${lastError}`)
              return false
            } finally {
              probing = null
            }
          })())

        const onPage = (url: string) => {
          if (settled) return
          const host = hostOf(url)
          diag.log(`page ${safeUrl(url)}`)
          if (SIGNIN_HOST.test(host)) {
            sawSignin = true
            return
          }
          // Back on rockstargames.com after the sign-in form: signed in, probably.
          if (!sawSignin || !ROCKSTAR_HOST.test(host)) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(
            () => void runProbe('retour du formulaire de connexion'),
            PROBE_DELAY_MS
          )
        }

        win.webContents.on('did-navigate', (_e, url) => onPage(url))
        win.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
          if (isMainFrame) onPage(url)
        })
        // A sign-in opened as a pop-up continues in this window.
        win.webContents.setWindowOpenHandler(({ url }) => {
          if (ROCKSTAR_HOST.test(hostOf(url))) void win.loadURL(url)
          return { action: 'deny' }
        })
        win.on('closed', () => {
          if (settled) return
          if (timer) clearTimeout(timer)
          // Closed by the user: signed in after all? One last try with what the session has.
          void (async () => {
            const ok = (await probing) || (await runProbe('fenêtre fermée'))
            if (ok || settled) return
            const where = options.logFile ? ` Détails : ${options.logFile}` : ''
            await finish({
              error: new AppError(
                'AUTH',
                sawSignin && lastError
                  ? `Connecté à Rockstar, mais Social Club refuse la lecture des jeux (${lastError}).${where}`
                  : 'Connexion Rockstar annulée.'
              )
            })
          })()
        })

        void ses
          .clearStorageData()
          .then(() => {
            ses.setUserAgent(browserUserAgent(ses))
            return win.loadURL(SOCIAL_CLUB_URL)
          })
          .catch((error: unknown) => diag.log(`chargement : ${String(error)}`))
      })
    },

    use(saved, fn) {
      const run = async () => {
        const ses = session.fromPartition('rockstar-sync')
        if (!guarded) {
          guard(ses)
          guarded = true
        }
        diag.log('synchro')
        await ses.clearStorageData()
        ses.setUserAgent(saved.userAgent)
        await importCookies(ses, saved.cookies)
        try {
          const result = await fn(access(ses, diag))
          const cookies = await exportCookies(ses)
          const session: SocialClubSession = {
            cookies: cookies.length ? cookies : saved.cookies,
            userAgent: saved.userAgent
          }
          return { session, result }
        } catch (error) {
          diag.log(`synchro refusée : ${error instanceof Error ? error.message : String(error)}`)
          throw error
        } finally {
          await ses.clearStorageData()
        }
      }
      // One sync at a time: they share the session.
      const next = queue.then(run, run)
      queue = next.catch(() => {})
      return next
    }
  }
}
