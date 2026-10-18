import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FetchLike } from '../../src/main/net/http'
import type { Cipher } from '../../src/main/secrets/store'

export const FIXTURES = resolve(__dirname, '../fixtures')
export const MIGRATIONS = resolve(__dirname, '../../drizzle')

export function apiFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, 'api', name), 'utf8'))
}

export function tempDir(prefix = 'shelf-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

type Route = [match: string | RegExp, respond: () => Response | Promise<Response>]

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export function binary(bytes: Uint8Array, contentType = 'image/png'): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } })
}

/**
 * Fake `fetch` replaying recorded responses: the first route whose string is contained
 * in (or regexp matches) the URL answers. Unmatched URLs fail the test loudly.
 */
export function fakeFetch(
  routes: Route[]
): FetchLike & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes.find(([match]) =>
      typeof match === 'string' ? url.includes(match) : match.test(url)
    )
    if (!route) throw new Error(`Unexpected request in test: ${url}`)
    return route[1]()
  }) as FetchLike & { calls: typeof calls }
  fn.calls = calls
  return fn
}

/** Reversible stand-in for safeStorage. */
export const fakeCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`),
  decrypt: (data) => Buffer.from(data.toString().slice(4), 'base64').toString()
}
