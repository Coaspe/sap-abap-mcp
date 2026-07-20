import { AppError } from "./errors.js"

const OAUTH_TOKEN_TIMEOUT_MS = 30_000

function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export interface OAuthClientCredentialsConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope?: string
}

export interface OAuthAccessTokenProvider {
  getAccessToken(): Promise<string>
  refreshRequired(): boolean
  invalidate(): void
}

export interface OAuthClientCredentialsOptions {
  fetch?: typeof fetch
  now?: () => number
}

interface CachedToken {
  accessToken: string
  refreshAt: number
}

export class OAuthClientCredentialsProvider implements OAuthAccessTokenProvider {
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => number
  private token: CachedToken | undefined
  private pending: Promise<CachedToken> | undefined

  constructor(
    private readonly config: OAuthClientCredentialsConfig,
    options: OAuthClientCredentialsOptions = {}
  ) {
    let tokenUrl: URL
    try {
      tokenUrl = new URL(config.tokenUrl)
    } catch {
      throw new AppError("OAUTH_TOKEN_URL_INVALID", "OAuth token URL is invalid")
    }
    if (
      tokenUrl.protocol !== "https:" ||
      tokenUrl.username || tokenUrl.password || tokenUrl.search || tokenUrl.hash
    ) {
      throw new AppError(
        "OAUTH_TOKEN_URL_INVALID",
        "OAuth token URL must use HTTPS and must not contain credentials, query parameters, or a fragment"
      )
    }
    if (!config.clientId || !config.clientSecret) {
      throw new AppError(
        "OAUTH_CLIENT_CREDENTIALS_REQUIRED",
        "OAuth client ID and client secret are required"
      )
    }
    this.fetchImplementation = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  async getAccessToken(): Promise<string> {
    if (this.token && !this.refreshRequired()) return this.token.accessToken
    if (!this.pending) {
      const pending = this.requestToken()
      this.pending = pending
      pending.finally(() => {
        if (this.pending === pending) this.pending = undefined
      }).catch(() => undefined)
    }
    this.token = await this.pending
    return this.token.accessToken
  }

  refreshRequired(): boolean {
    return Boolean(this.token && this.now() >= this.token.refreshAt)
  }

  invalidate(): void {
    this.token = undefined
    this.pending = undefined
  }

  private async requestToken(): Promise<CachedToken> {
    const body = new URLSearchParams({ grant_type: "client_credentials" })
    if (this.config.scope) body.set("scope", this.config.scope)
    let response: Response
    try {
      response = await this.fetchImplementation(this.config.tokenUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(
            `${formEncode(this.config.clientId)}:${formEncode(this.config.clientSecret)}`,
            "utf8"
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: body.toString(),
        signal: AbortSignal.timeout(OAUTH_TOKEN_TIMEOUT_MS)
      })
    } catch {
      throw new AppError(
        "OAUTH_TOKEN_REQUEST_FAILED",
        "OAuth token request failed before a response was received",
        { tokenUrl: this.config.tokenUrl }
      )
    }
    if (!response.ok) {
      throw new AppError(
        "OAUTH_TOKEN_REQUEST_FAILED",
        `OAuth token endpoint returned HTTP ${response.status}`,
        { tokenUrl: this.config.tokenUrl, httpStatus: response.status }
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new AppError(
        "OAUTH_TOKEN_RESPONSE_INVALID",
        "OAuth token endpoint did not return valid JSON",
        { tokenUrl: this.config.tokenUrl }
      )
    }
    if (typeof payload !== "object" || payload === null) {
      throw new AppError(
        "OAUTH_TOKEN_RESPONSE_INVALID",
        "OAuth token response must be an object",
        { tokenUrl: this.config.tokenUrl }
      )
    }
    const record = payload as Record<string, unknown>
    const accessToken = record.access_token
    const expiresIn = Number(record.expires_in)
    const tokenType = record.token_type
    if (
      typeof accessToken !== "string" || !accessToken ||
      !Number.isFinite(expiresIn) || expiresIn <= 0 ||
      (tokenType !== undefined &&
        (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer"))
    ) {
      throw new AppError(
        "OAUTH_TOKEN_RESPONSE_INVALID",
        "OAuth token response requires a Bearer access_token and positive expires_in",
        { tokenUrl: this.config.tokenUrl }
      )
    }
    const lifetimeMs = expiresIn * 1000
    const refreshBufferMs = Math.min(60_000, Math.max(1_000, lifetimeMs * 0.1))
    return {
      accessToken,
      refreshAt: this.now() + lifetimeMs - refreshBufferMs
    }
  }
}
