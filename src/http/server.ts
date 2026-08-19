import { randomUUID } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http"
import { stderr } from "node:process"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { AuditOutcome, AuditRecorder } from "../audit-log.js"
import { AppError } from "../errors.js"
import {
  bearerCredential,
  resolveApiKeyPrincipal,
  type ApiKeyRecord,
  type HttpPrincipal
} from "./auth.js"
import type { OidcAuthenticator } from "./oidc.js"
import {
  ConcurrencyLimiter,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  DEFAULT_RATE_LIMIT_PER_PRINCIPAL,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  FixedWindowRateLimiter
} from "./rate-limit.js"

export const MCP_ENDPOINT = "/mcp"
export const HEALTH_ENDPOINT = "/healthz"
export const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024
export const DEFAULT_HTTP_PORT = 3000
export const DEFAULT_HTTP_HOST = "127.0.0.1"
export const DEFAULT_MAX_SESSIONS = 64
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SESSION_SWEEP_INTERVAL_MS = 60_000

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store"
}

const CORS_ALLOWED_HEADERS = [
  "authorization",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id"
].join(", ")

export interface McpSessionContext {
  principal: HttpPrincipal
  auditRecorder?: AuditRecorder
  sapBearerToken?: string
}

export interface McpSessionInstance {
  server: McpServer
  /** Release background work owned by this session, if any. */
  dispose?: () => void | Promise<void>
}

export interface HttpServerOptions {
  /** SAP-facing MCP server factory. One server instance is created per session. */
  createMcpServerForSession: (context: McpSessionContext) => McpSessionInstance
  apiKeys: readonly ApiKeyRecord[]
  /** Optional OIDC/JWT authenticator, accepted alongside API keys. */
  oidc?: OidcAuthenticator
  /**
   * Server-side secret for API key records stored as `keyHmacSha256`. Without
   * it those records cannot verify, so a missing secret denies access rather
   * than falling back to a weaker check.
   */
  apiKeyPepper?: string
  host?: string
  port?: number
  allowedOrigins?: readonly string[]
  allowedHosts?: readonly string[]
  rateLimitPerPrincipal?: number
  rateLimitWindowMs?: number
  maxConcurrentRequests?: number
  maxSessions?: number
  sessionIdleTimeoutMs?: number
  auditRecorder?: AuditRecorder
  log?: (line: string) => void
}

interface McpSession {
  transport: StreamableHTTPServerTransport
  instance: McpSessionInstance
  principal: HttpPrincipal
  lastSeenAt: number
}

interface SessionEventContext {
  outcome: AuditOutcome
  name: string
  errorCode?: string
  principalId?: string
  principalSource?: HttpPrincipal["source"]
}

/**
 * A request that failed authentication has no known actor. Recording the
 * server's own OS user there would attribute the attempt to the operator, so an
 * unauthenticated event is stamped with an explicit unknown principal.
 */
const UNKNOWN_PRINCIPAL = { id: "unknown", source: "unknown" } as const

function jsonRpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null })
}

function headerValue(
  request: IncomingMessage,
  name: string
): string | undefined {
  const raw = request.headers[name]
  if (Array.isArray(raw)) return raw[0]
  return typeof raw === "string" ? raw : undefined
}

function hostOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().toLowerCase()
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1)
  const colon = trimmed.lastIndexOf(":")
  return colon > 0 ? trimmed.slice(0, colon) : trimmed
}

async function readBody(
  request: IncomingMessage,
  limit: number
): Promise<string | undefined> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    bytes += buffer.length
    if (bytes > limit) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function isInitializeBody(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body]
  return messages.some(message =>
    message !== null && typeof message === "object" &&
    (message as { method?: unknown }).method === "initialize"
  )
}

export interface RunningHttpServer {
  readonly host: string
  readonly port: number
  readonly url: string
  readonly sessionCount: () => number
  close: () => Promise<void>
}

/**
 * Serve MCP over Streamable HTTP for a shared, centrally operated deployment.
 *
 * The listener is built directly on `node:http`: this server deliberately adds
 * no HTTP framework dependency, so its attack surface and supply chain stay the
 * same as the stdio runtime.
 *
 * Every request to {@link MCP_ENDPOINT} must present a Bearer API key. A session
 * is bound to the principal that created it, so a leaked session id cannot be
 * reused under a different key.
 */
export async function startHttpMcpServer(
  options: HttpServerOptions
): Promise<RunningHttpServer> {
  if (options.apiKeys.length === 0 && !options.oidc) {
    throw new AppError(
      "CLIENT_AUTH_REQUIRED",
      "HTTP mode requires at least one API key or an OIDC issuer. Create a key with: sap-abap-mcp apikey new <id>"
    )
  }
  const host = options.host ?? DEFAULT_HTTP_HOST
  const port = options.port ?? DEFAULT_HTTP_PORT
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? []).map(origin => origin.trim().toLowerCase())
  )
  const allowedHosts = new Set(
    (options.allowedHosts ?? []).map(entry => entry.trim().toLowerCase())
  )
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  const sessionIdleTimeoutMs = options.sessionIdleTimeoutMs ??
    DEFAULT_SESSION_IDLE_TIMEOUT_MS
  const log = options.log ?? ((line: string) => stderr.write(`${line}\n`))
  const rateLimiter = new FixedWindowRateLimiter({
    limit: options.rateLimitPerPrincipal ?? DEFAULT_RATE_LIMIT_PER_PRINCIPAL,
    windowMs: options.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS
  })
  const concurrency = new ConcurrencyLimiter(
    options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS
  )
  const sessions = new Map<string, McpSession>()

  const recordSessionEvent = (
    context: SessionEventContext,
    startedAt: bigint
  ): void => {
    options.auditRecorder?.record({
      kind: "session",
      name: context.name,
      mutation: false,
      destructive: false,
      outcome: context.outcome,
      durationMs: Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000,
      ...(context.errorCode !== undefined ? { errorCode: context.errorCode } : {}),
      principal: context.principalId !== undefined
        ? {
            id: context.principalId,
            source: context.principalSource ?? "api-key"
          }
        : UNKNOWN_PRINCIPAL
    })
  }

  const applyBaseHeaders = (
    request: IncomingMessage,
    response: ServerResponse
  ): void => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value)
    }
    const origin = headerValue(request, "origin")
    if (origin && allowedOrigins.has(origin.trim().toLowerCase())) {
      response.setHeader("access-control-allow-origin", origin)
      response.setHeader("vary", "Origin")
      response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS")
      response.setHeader("access-control-allow-headers", CORS_ALLOWED_HEADERS)
      response.setHeader("access-control-expose-headers", "mcp-session-id")
      response.setHeader("access-control-max-age", "600")
    }
  }

  const sendJson = (
    response: ServerResponse,
    status: number,
    body: string,
    extraHeaders: Record<string, string> = {}
  ): void => {
    response.writeHead(status, {
      "content-type": "application/json",
      ...extraHeaders
    })
    response.end(body)
  }

  const closeSession = async (sessionId: string): Promise<void> => {
    const session = sessions.get(sessionId)
    if (!session) return
    sessions.delete(sessionId)
    await session.instance.server.close().catch(() => undefined)
    await session.transport.close().catch(() => undefined)
    await session.instance.dispose?.()
  }

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [sessionId, session] of sessions) {
      if (now - session.lastSeenAt > sessionIdleTimeoutMs) {
        void closeSession(sessionId)
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS)
  sweep.unref()

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> => {
    const startedAt = process.hrtime.bigint()
    applyBaseHeaders(request, response)
    const url = new URL(request.url ?? "/", "http://localhost")
    const path = url.pathname

    // An Origin header means a browser sent this request. Reject it unless the
    // operator explicitly allowlisted that origin; this is the DNS-rebinding
    // and cross-site defense for a locally reachable server.
    const origin = headerValue(request, "origin")
    if (origin && !allowedOrigins.has(origin.trim().toLowerCase())) {
      recordSessionEvent(
        { outcome: "denied", name: "http.origin", errorCode: "ORIGIN_NOT_ALLOWED" },
        startedAt
      )
      sendJson(response, 403, jsonRpcError(-32003, "Origin not allowed"))
      return
    }
    if (allowedHosts.size > 0) {
      const requestHost = hostOf(headerValue(request, "host"))
      if (!requestHost || !allowedHosts.has(requestHost)) {
        recordSessionEvent(
          { outcome: "denied", name: "http.host", errorCode: "HOST_NOT_ALLOWED" },
          startedAt
        )
        sendJson(response, 403, jsonRpcError(-32003, "Host not allowed"))
        return
      }
    }

    if (request.method === "OPTIONS") {
      response.writeHead(origin ? 204 : 405).end()
      return
    }

    if (path === HEALTH_ENDPOINT) {
      if (request.method !== "GET") {
        sendJson(response, 405, jsonRpcError(-32000, "Method not allowed"))
        return
      }
      sendJson(response, 200, JSON.stringify({
        status: "ok",
        sessions: sessions.size,
        inFlight: concurrency.inFlight
      }))
      return
    }

    if (path !== MCP_ENDPOINT) {
      sendJson(response, 404, jsonRpcError(-32601, "Not found"))
      return
    }

    const credential = bearerCredential(headerValue(request, "authorization"))
    // A JWT has three dot-separated segments; an API key never does. Trying the
    // key store first keeps a static key from ever being sent to the JWKS path.
    let principal = resolveApiKeyPrincipal(
      options.apiKeys,
      credential,
      options.apiKeyPepper
    )
    if (!principal && options.oidc && credential?.split(".").length === 3) {
      try {
        principal = await options.oidc.resolve(credential)
      } catch (error) {
        recordSessionEvent(
          {
            outcome: "denied",
            name: "http.authenticate",
            errorCode: error instanceof AppError ? error.code : "JWT_INVALID"
          },
          startedAt
        )
        sendJson(response, 401, jsonRpcError(-32001, "Unauthorized"), {
          "www-authenticate": "Bearer realm=\"sap-abap-mcp\", error=\"invalid_token\""
        })
        return
      }
    }
    if (!principal) {
      recordSessionEvent(
        {
          outcome: "denied",
          name: "http.authenticate",
          errorCode: "API_KEY_INVALID"
        },
        startedAt
      )
      sendJson(response, 401, jsonRpcError(-32001, "Unauthorized"), {
        "www-authenticate": "Bearer realm=\"sap-abap-mcp\""
      })
      return
    }

    const decision = rateLimiter.check(principal.id)
    response.setHeader("ratelimit-limit", String(decision.limit))
    response.setHeader("ratelimit-remaining", String(decision.remaining))
    if (!decision.allowed) {
      recordSessionEvent(
        {
          outcome: "denied",
          name: "http.rate_limit",
          errorCode: "RATE_LIMIT_EXCEEDED",
          principalId: principal.id,
          principalSource: principal.source
        },
        startedAt
      )
      sendJson(response, 429, jsonRpcError(-32002, "Rate limit exceeded"), {
        "retry-after": String(decision.retryAfterSeconds)
      })
      return
    }

    let parsedBody: unknown
    if (request.method === "POST") {
      const text = await readBody(request, MAX_REQUEST_BODY_BYTES)
      if (text === undefined) {
        sendJson(response, 413, jsonRpcError(-32600, "Request body too large"))
        return
      }
      try {
        parsedBody = JSON.parse(text)
      } catch {
        sendJson(response, 400, jsonRpcError(-32700, "Parse error"))
        return
      }
    }

    const sessionId = headerValue(request, "mcp-session-id")
    if (sessionId) {
      const session = sessions.get(sessionId)
      if (!session) {
        sendJson(response, 404, jsonRpcError(-32004, "Session not found"))
        return
      }
      // Bind a session to the principal that opened it, so a captured session
      // id cannot be replayed under a different API key.
      if (session.principal.id !== principal.id) {
        recordSessionEvent(
          {
            outcome: "denied",
            name: "http.session.bind",
            errorCode: "SESSION_PRINCIPAL_MISMATCH",
            principalId: principal.id,
            principalSource: principal.source
          },
          startedAt
        )
        sendJson(response, 403, jsonRpcError(-32003, "Session belongs to another principal"))
        return
      }
      session.lastSeenAt = Date.now()
      if (request.method === "DELETE") {
        recordSessionEvent(
          {
            outcome: "succeeded",
            name: "http.session.close",
            principalId: principal.id,
            principalSource: principal.source
          },
          startedAt
        )
      }
      const release = await concurrency.acquire()
      try {
        await session.transport.handleRequest(request, response, parsedBody)
      } finally {
        release()
      }
      return
    }

    if (request.method !== "POST" || !isInitializeBody(parsedBody)) {
      sendJson(
        response,
        400,
        jsonRpcError(-32600, "mcp-session-id is required except on initialize")
      )
      return
    }

    if (sessions.size >= maxSessions) {
      recordSessionEvent(
        {
          outcome: "denied",
          name: "http.session.open",
          errorCode: "SESSION_LIMIT_REACHED",
          principalId: principal.id,
          principalSource: principal.source
        },
        startedAt
      )
      sendJson(response, 503, jsonRpcError(-32005, "Session limit reached"))
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessionclosed: closed => {
        void closeSession(closed)
      }
    })
    const sessionRecorder = options.auditRecorder?.withPrincipal({
      id: principal.id,
      source: principal.source
    })
    const instance = options.createMcpServerForSession({
      principal,
      ...(principal.source === "oidc" && credential ? { sapBearerToken: credential } : {}),
      ...(sessionRecorder ? { auditRecorder: sessionRecorder } : {})
    })
    transport.onclose = () => {
      const current = transport.sessionId
      if (current) void closeSession(current)
    }
    // `StreamableHTTPServerTransport` declares `onclose` as a mutable accessor
    // typed `(() => void) | undefined`, which `exactOptionalPropertyTypes`
    // rejects against the optional `Transport.onclose`. The runtime shape is
    // correct, so narrow to the parameter type the SDK expects.
    await instance.server.connect(
      transport as unknown as Parameters<McpServer["connect"]>[0]
    )
    const release = await concurrency.acquire()
    try {
      await transport.handleRequest(request, response, parsedBody)
    } finally {
      release()
    }
    const opened = transport.sessionId
    if (opened) {
      sessions.set(opened, {
        transport,
        instance,
        principal,
        lastSeenAt: Date.now()
      })
      recordSessionEvent(
        {
          outcome: "succeeded",
          name: "http.session.open",
          principalId: principal.id,
          principalSource: principal.source
        },
        startedAt
      )
    } else {
      await instance.server.close().catch(() => undefined)
      await instance.dispose?.()
    }
  }

  const httpServer: Server = createServer((request, response) => {
    handle(request, response).catch(error => {
      log(`sap-abap-mcp http error: ${
        error instanceof Error ? error.message : String(error)
      }`)
      if (!response.headersSent) {
        sendJson(response, 500, jsonRpcError(-32603, "Internal server error"))
      } else {
        response.end()
      }
    })
  })
  httpServer.headersTimeout = 60_000
  httpServer.requestTimeout = 0

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject)
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject)
      resolve()
    })
  })

  const address = httpServer.address()
  const boundPort = typeof address === "object" && address !== null
    ? address.port
    : port
  const displayHost = host.includes(":") ? `[${host}]` : host
  log(
    `sap-abap-mcp listening on http://${displayHost}:${boundPort}${MCP_ENDPOINT} ` +
    `(${options.apiKeys.length} API key(s), origins: ${
      allowedOrigins.size === 0 ? "none" : [...allowedOrigins].join(",")
    })`
  )

  return {
    host,
    port: boundPort,
    url: `http://${displayHost}:${boundPort}${MCP_ENDPOINT}`,
    sessionCount: () => sessions.size,
    close: async () => {
      clearInterval(sweep)
      await Promise.all([...sessions.keys()].map(id => closeSession(id)))
      await new Promise<void>(resolve => {
        httpServer.close(() => resolve())
      })
      httpServer.closeAllConnections?.()
    }
  }
}
