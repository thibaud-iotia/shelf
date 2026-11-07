// In-memory caches of the store's network answers (prices change, so entries expire).
// Failures are never kept. In-flight requests are shared: a second caller waits for the
// first request instead of sending its own (warm-up and a click at the same time).

/** Runs at most `max` tasks at once, the others wait their turn (in call order). */
export function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    active--
    queue.shift()?.()
  }
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++
        task().then(resolve, reject).finally(next)
      }
      if (active < max) run()
      else queue.push(run)
    })
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export class TtlCache {
  private readonly entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>()

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Cached value of `key`, loaded once until it expires. */
  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.value as Promise<T>
    const value = load()
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, value })
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key)
    })
    return value
  }

  /**
   * Batch endpoint cached per id: ids already known (or being fetched) are not asked again,
   * the others are fetched `size` at a time, the chunks in parallel (the client limits how
   * many requests run at once).
   * Ids missing from an answer are cached as null (not asked again until expiry).
   * Rejects when a chunk fails.
   */
  async many<T>(
    prefix: string,
    ids: string[],
    size: number,
    load: (part: string[]) => Promise<Map<string, T>>
  ): Promise<Map<string, T>> {
    const unique = [...new Set(ids)]
    const missing = unique.filter((id) => {
      const hit = this.entries.get(`${prefix}:${id}`)
      return !hit || hit.expiresAt <= this.now()
    })
    for (const part of chunks(missing.sort(), size)) {
      const answer = load(part)
      for (const id of part)
        this.get(`${prefix}:${id}`, () => answer.then((m) => m.get(id) ?? null))
    }
    const values = await Promise.all(
      unique.map((id) => this.entries.get(`${prefix}:${id}`)!.value as Promise<T | null>)
    )
    const out = new Map<string, T>()
    values.forEach((value, i) => {
      if (value !== null) out.set(unique[i]!, value)
    })
    return out
  }
}
