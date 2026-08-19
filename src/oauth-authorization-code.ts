import { createHash, randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { AppError } from "./errors.js"
import type { OAuthAccessTokenProvider } from "./oauth-client-credentials.js"

const TOKEN_TIMEOUT_MS = 30_000
const BROWSER_LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export interface OAuthAuthorizationCodeConfig {
  authorizationUrl: string
  tokenUrl: string
  clientId: string
  scope?: string
}

interface StoredAuthorizationCredential {
  version: 1
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

interface TokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export interface OAuthAuthorizationCodeOptions {
  fetch?: typeof fetch
  now?: () => number
  persistCredential?: (credential: string) => Promise<void>
}

export interface BrowserOAuthLoginOptions {
  fetch?: typeof fetch
  openBrowser?: (url: string) => void
  timeoutMs?: number
}

function validateHttpsEndpoint(value: string, label: string): void {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new AppError("OAUTH_ENDPOINT_INVALID", `${label} is invalid`)
  }
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash
  ) {
    throw new AppError(
      "OAUTH_ENDPOINT_INVALID",
      `${label} must use HTTPS and must not contain credentials, query parameters, or a fragment`
    )
  }
}

function parseCredential(value: string): StoredAuthorizationCredential {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new AppError("OAUTH_CREDENTIAL_INVALID", "Stored browser OAuth credential is invalid")
  }
  const record = parsed as Partial<StoredAuthorizationCredential>
  if (
    record?.version !== 1 || typeof record.accessToken !== "string" ||
    !record.accessToken || typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt) ||
    (record.refreshToken !== undefined && typeof record.refreshToken !== "string")
  ) {
    throw new AppError("OAUTH_CREDENTIAL_INVALID", "Stored browser OAuth credential is invalid")
  }
  return record as StoredAuthorizationCredential
}

function encodeCredential(value: StoredAuthorizationCredential): string {
  return JSON.stringify(value)
}

async function requestToken(
  config: OAuthAuthorizationCodeConfig,
  body: URLSearchParams,
  fetchImplementation: typeof fetch
): Promise<TokenResponse> {
  let response: Response
  try {
    response = await fetchImplementation(config.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    })
  } catch {
    throw new AppError(
      "OAUTH_TOKEN_REQUEST_FAILED",
      "OAuth token request failed before a response was received",
      { tokenUrl: config.tokenUrl }
    )
  }
  if (!response.ok) {
    throw new AppError(
      "OAUTH_TOKEN_REQUEST_FAILED",
      `OAuth token endpoint returned HTTP ${response.status}`,
      { tokenUrl: config.tokenUrl, httpStatus: response.status }
    )
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new AppError(
      "OAUTH_TOKEN_RESPONSE_INVALID",
      "OAuth token endpoint did not return valid JSON",
      { tokenUrl: config.tokenUrl }
    )
  }
  const record = payload as Record<string, unknown>
  const accessToken = record?.access_token
  const refreshToken = record?.refresh_token
  const expiresIn = Number(record?.expires_in)
  const tokenType = record?.token_type
  if (
    typeof accessToken !== "string" || !accessToken ||
    !Number.isFinite(expiresIn) || expiresIn <= 0 ||
    (refreshToken !== undefined && typeof refreshToken !== "string") ||
    (tokenType !== undefined &&
      (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer"))
  ) {
    throw new AppError(
      "OAUTH_TOKEN_RESPONSE_INVALID",
      "OAuth token response requires a Bearer access_token and positive expires_in",
      { tokenUrl: config.tokenUrl }
    )
  }
  return {
    accessToken,
    expiresIn,
    ...(typeof refreshToken === "string" && refreshToken ? { refreshToken } : {})
  }
}

function defaultOpenBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "rundll32"
      : "xdg-open"
  const args = process.platform === "win32"
    ? ["url.dll,FileProtocolHandler", url]
    : [url]
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
  child.once("error", () => undefined)
  child.unref()
}

export class OAuthAuthorizationCodeProvider implements OAuthAccessTokenProvider {
  private credential: StoredAuthorizationCredential
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => number
  private pending: Promise<string> | undefined

  constructor(
    private readonly config: OAuthAuthorizationCodeConfig,
    encodedCredential: string,
    private readonly options: OAuthAuthorizationCodeOptions = {}
  ) {
    validateHttpsEndpoint(config.authorizationUrl, "OAuth authorization URL")
    validateHttpsEndpoint(config.tokenUrl, "OAuth token URL")
    if (!config.clientId) {
      throw new AppError("OAUTH_CLIENT_ID_REQUIRED", "OAuth client ID is required")
    }
    this.credential = parseCredential(encodedCredential)
    this.fetchImplementation = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  async getAccessToken(): Promise<string> {
    if (!this.refreshRequired()) return this.credential.accessToken
    if (!this.pending) {
      const pending = this.refresh()
      this.pending = pending
      pending.finally(() => {
        if (this.pending === pending) this.pending = undefined
      }).catch(() => undefined)
    }
    return this.pending
  }

  refreshRequired(): boolean {
    return this.now() >= this.credential.expiresAt
  }

  invalidate(): void {
    this.credential.expiresAt = 0
    this.pending = undefined
  }

  private async refresh(): Promise<string> {
    if (!this.credential.refreshToken) {
      throw new AppError(
        "AUTH_REQUIRED",
        "Browser OAuth access token expired without a refresh token; run auth login again"
      )
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.credential.refreshToken,
      client_id: this.config.clientId
    })
    if (this.config.scope) body.set("scope", this.config.scope)
    const token = await requestToken(this.config, body, this.fetchImplementation)
    this.credential = {
      version: 1,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? this.credential.refreshToken,
      expiresAt: this.now() + token.expiresIn * 1000 - Math.min(60_000, token.expiresIn * 100)
    }
    await this.options.persistCredential?.(encodeCredential(this.credential))
    return this.credential.accessToken
  }
}

export async function browserOAuthLogin(
  config: OAuthAuthorizationCodeConfig,
  options: BrowserOAuthLoginOptions = {}
): Promise<string> {
  validateHttpsEndpoint(config.authorizationUrl, "OAuth authorization URL")
  validateHttpsEndpoint(config.tokenUrl, "OAuth token URL")
  if (!config.clientId) throw new AppError("OAUTH_CLIENT_ID_REQUIRED", "OAuth client ID is required")

  const state = randomBytes(24).toString("base64url")
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  let resolveCode!: (code: string) => void
  let rejectCode!: (error: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const server = createServer((request, response) => {
    const callback = new URL(request.url ?? "/", "http://127.0.0.1")
    if (callback.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found")
      return
    }
    const returnedState = callback.searchParams.get("state")
    const code = callback.searchParams.get("code")
    const oauthError = callback.searchParams.get("error")
    if (returnedState !== state || !code || oauthError) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
        .end("SAP ABAP MCP login failed. You may close this window.")
      rejectCode(new AppError("OAUTH_CALLBACK_INVALID", "Browser OAuth callback was rejected"))
      return
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end("SAP ABAP MCP login succeeded. You may close this window.")
    resolveCode(code)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new AppError("OAUTH_CALLBACK_FAILED", "Could not start the browser OAuth callback")
  }
  const redirectUri = `http://127.0.0.1:${address.port}/callback`
  const authorizationUrl = new URL(config.authorizationUrl)
  authorizationUrl.searchParams.set("response_type", "code")
  authorizationUrl.searchParams.set("client_id", config.clientId)
  authorizationUrl.searchParams.set("redirect_uri", redirectUri)
  authorizationUrl.searchParams.set("state", state)
  authorizationUrl.searchParams.set("code_challenge", challenge)
  authorizationUrl.searchParams.set("code_challenge_method", "S256")
  if (config.scope) authorizationUrl.searchParams.set("scope", config.scope)

  try {
    (options.openBrowser ?? defaultOpenBrowser)(authorizationUrl.toString())
    const timeoutMs = options.timeoutMs ?? BROWSER_LOGIN_TIMEOUT_MS
    const code = await Promise.race([
      codePromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new AppError("OAUTH_CALLBACK_TIMEOUT", "Browser OAuth login timed out")),
          timeoutMs
        ).unref()
      })
    ])
    const token = await requestToken(
      config,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: verifier
      }),
      options.fetch ?? fetch
    )
    return encodeCredential({
      version: 1,
      accessToken: token.accessToken,
      ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      expiresAt: Date.now() + token.expiresIn * 1000 - Math.min(60_000, token.expiresIn * 100)
    })
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}
