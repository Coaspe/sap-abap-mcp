export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
export const DEFAULT_RATE_LIMIT_PER_PRINCIPAL = 240
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 8

export interface RateLimitDecision {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSeconds: number
}

interface Window {
  count: number
  resetAt: number
}

export interface FixedWindowRateLimiterOptions {
  limit?: number
  windowMs?: number
  now?: () => number
  maxTrackedKeys?: number
}

/**
 * Fixed-window request counter keyed by principal or client address. A fixed
 * window is chosen over a token bucket because the limit it advertises through
 * `RateLimit-*` headers is exact and easy for an operator to reason about.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly maxTrackedKeys: number

  constructor(options: FixedWindowRateLimiterOptions = {}) {
    this.limit = options.limit ?? DEFAULT_RATE_LIMIT_PER_PRINCIPAL
    this.windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
    this.now = options.now ?? Date.now
    this.maxTrackedKeys = options.maxTrackedKeys ?? 10_000
  }

  check(key: string): RateLimitDecision {
    const now = this.now()
    this.removeExpired(now)
    let window = this.windows.get(key)
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs }
      if (this.windows.size >= this.maxTrackedKeys) {
        const oldest = this.windows.keys().next()
        if (!oldest.done) this.windows.delete(oldest.value)
      }
      this.windows.set(key, window)
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000))
    if (window.count >= this.limit) {
      return { allowed: false, limit: this.limit, remaining: 0, retryAfterSeconds }
    }
    window.count += 1
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - window.count,
      retryAfterSeconds
    }
  }

  private removeExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key)
    }
  }
}

/**
 * Bound how many requests may be in flight against SAP at once, so one busy MCP
 * client cannot exhaust the SAP system's dialog work processes.
 */
export class ConcurrencyLimiter {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly maxConcurrent = DEFAULT_MAX_CONCURRENT_REQUESTS) {}

  get inFlight(): number {
    return this.active
  }

  get queued(): number {
    return this.waiting.length
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>(resolve => {
        this.waiting.push(resolve)
      })
    }
    this.active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const next = this.waiting.shift()
      if (next) next()
    }
  }
}
