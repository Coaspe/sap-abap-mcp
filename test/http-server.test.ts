import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  AuditRecorder,
  type AuditEvent,
  type AuditSink
} from "../src/audit-log.js"
import {
  bearerCredential,
  generateApiKey,
  hashApiKey,
  loadApiKeyRecords,
  parseApiKeyFile,
  parseHttpRole,
  resolveApiKeyPrincipal,
  type ApiKeyRecord
} from "../src/http/auth.js"
import {
  ConcurrencyLimiter,
  FixedWindowRateLimiter
} from "../src/http/rate-limit.js"
import {
  startHttpMcpServer,
  type RunningHttpServer
} from "../src/http/server.js"
import {
  ADMIN_ONLY_V1_TOOLS,
  isToolAllowedForRole
} from "../src/mcp/role-policy.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AbapToolService } from "../src/tool-service.js"

const READ_ONLY = { readOnlyHint: true, destructiveHint: false }
const MUTATION = { readOnlyHint: false, destructiveHint: true }

function memorySink(): AuditSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    name: "stderr",
    events,
    write: event => {
      events.push(event)
    },
    close: async () => undefined
  }
}

function keyRecord(id: string, role: "viewer" | "developer" | "admin", key: string): ApiKeyRecord {
  return { id, role, keySha256: hashApiKey(key) }
}

function service(): AbapToolService {
  return new AbapToolService({
    async listConnections() {
      return [{
        id: "DEV100",
        url: "https://sap.example.com",
        client: "100",
        language: "EN",
        environment: "development" as const,
        credentialAvailable: true
      }]
    },
    async getClient() { throw new Error("no live SAP in tests") }
  })
}

interface Harness {
  server: RunningHttpServer
  sink: AuditSink & { events: AuditEvent[] }
}

async function startHarness(keys: ApiKeyRecord[], options: {
  allowedOrigins?: string[]
  rateLimitPerPrincipal?: number
  maxSessions?: number
} = {}): Promise<Harness> {
  const sink = memorySink()
  const recorder = new AuditRecorder({ sink, apiVersion: "v1" })
  const server = await startHttpMcpServer({
    apiKeys: keys,
    port: 0,
    auditRecorder: recorder,
    log: () => undefined,
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.rateLimitPerPrincipal !== undefined
      ? { rateLimitPerPrincipal: options.rateLimitPerPrincipal }
      : {}),
    ...(options.maxSessions !== undefined ? { maxSessions: options.maxSessions } : {}),
    createMcpServerForSession: ({ principal, auditRecorder: sessionRecorder }) => {
      const instance = service()
      return {
        server: createMcpServer(instance, {
          apiVersion: "v1",
          role: principal.role,
          ...(sessionRecorder ? { auditRecorder: sessionRecorder } : {})
        }),
        dispose: () => instance.dispose()
      }
    }
  })
  return { server, sink }
}

async function connectClient(
  harness: Harness,
  key: string
): Promise<Client> {
  const client = new Client({ name: "http-test", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(harness.server.url), {
    requestInit: { headers: { authorization: `Bearer ${key}` } }
  })
  // `StreamableHTTPClientTransport.sessionId` is `string | undefined`, which
  // `exactOptionalPropertyTypes` rejects against the optional `Transport`
  // member. The runtime shape is correct.
  await client.connect(transport as unknown as Parameters<Client["connect"]>[0])
  return client
}

test("API key files store only hashes and reject malformed records", () => {
  const key = generateApiKey()
  const records = parseApiKeyFile(JSON.stringify({
    keys: [{ id: "alice", role: "developer", keySha256: hashApiKey(key) }]
  }))

  assert.deepEqual(records, [{
    id: "alice",
    role: "developer",
    keySha256: hashApiKey(key)
  }])
  assert.throws(() => parseApiKeyFile("{"), /API_KEY_FILE_INVALID|not valid JSON/)
  assert.throws(() => parseApiKeyFile("{}"), /non-empty/)
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({ keys: [{ id: "a b", role: "viewer", keySha256: hashApiKey(key) }] })),
    /keys\[0\]\.id/
  )
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({ keys: [{ id: "alice", role: "viewer", keySha256: "short" }] })),
    /must be a 64-character hex digest/
  )
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({ keys: [{ id: "alice", role: "root", keySha256: hashApiKey(key) }] })),
    /Unknown role/
  )
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({
      keys: [
        { id: "alice", role: "viewer", keySha256: hashApiKey(key) },
        { id: "alice", role: "admin", keySha256: hashApiKey(generateApiKey()) }
      ]
    })),
    /Duplicate API key id/
  )
})

test("bearer credentials are parsed and unknown keys resolve to no principal", () => {
  const key = generateApiKey()
  const records = [keyRecord("alice", "developer", key)]

  assert.equal(bearerCredential(`Bearer ${key}`), key)
  assert.equal(bearerCredential(`bearer   ${key}`), key)
  assert.equal(bearerCredential(`Basic ${key}`), undefined)
  assert.equal(bearerCredential(undefined), undefined)
  assert.deepEqual(resolveApiKeyPrincipal(records, key), {
    id: "alice",
    role: "developer",
    source: "api-key"
  })
  assert.equal(resolveApiKeyPrincipal(records, generateApiKey()), undefined)
  assert.equal(resolveApiKeyPrincipal(records, "short"), undefined)
  assert.equal(resolveApiKeyPrincipal(records, undefined), undefined)
})

test("generated API keys meet the minimum accepted length", () => {
  assert.ok(generateApiKey().length >= 32)
  assert.equal(parseHttpRole("ADMIN"), "admin")
})

test("role policy hides mutations from viewers and admin-only tools from developers", () => {
  assert.equal(isToolAllowedForRole("viewer", "sap.system.list", READ_ONLY), true)
  assert.equal(isToolAllowedForRole("viewer", "sap.source.patch", MUTATION), false)
  assert.equal(isToolAllowedForRole("developer", "sap.source.patch", MUTATION), true)
  assert.equal(isToolAllowedForRole("developer", "sap.transport.release", MUTATION), false)
  assert.equal(isToolAllowedForRole("admin", "sap.transport.release", MUTATION), true)
  // A read-only capability stays available at every role.
  for (const name of ADMIN_ONLY_V1_TOOLS) {
    assert.equal(isToolAllowedForRole("viewer", name, READ_ONLY), true)
  }
})

test("an API key file is loaded from disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-keys-"))
  try {
    const key = generateApiKey()
    const path = join(directory, "keys.json")
    await writeFile(path, JSON.stringify({
      keys: [{ id: "ops", role: "admin", keySha256: hashApiKey(key) }]
    }))
    assert.deepEqual(loadApiKeyRecords(path), [keyRecord("ops", "admin", key)])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("the fixed-window rate limiter blocks past its limit and resets", () => {
  let now = 1_000
  const limiter = new FixedWindowRateLimiter({
    limit: 2,
    windowMs: 1_000,
    now: () => now
  })

  assert.equal(limiter.check("alice").allowed, true)
  assert.equal(limiter.check("alice").allowed, true)
  const blocked = limiter.check("alice")
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.remaining, 0)
  assert.ok(blocked.retryAfterSeconds >= 1)
  // A different principal has its own window.
  assert.equal(limiter.check("bob").allowed, true)
  now += 1_001
  assert.equal(limiter.check("alice").allowed, true)
})

test("the concurrency limiter serializes work beyond its bound", async () => {
  const limiter = new ConcurrencyLimiter(1)
  const first = await limiter.acquire()
  assert.equal(limiter.inFlight, 1)
  let secondAcquired = false
  const second = limiter.acquire().then(release => {
    secondAcquired = true
    return release
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(secondAcquired, false)
  first()
  const releaseSecond = await second
  assert.equal(secondAcquired, true)
  releaseSecond()
  assert.equal(limiter.inFlight, 0)
})

test("HTTP mode refuses to start without at least one API key", async () => {
  await assert.rejects(
    startHttpMcpServer({
      apiKeys: [],
      port: 0,
      log: () => undefined,
      createMcpServerForSession: () => ({
        server: createMcpServer(service(), { apiVersion: "v1" })
      })
    }),
    /API_KEYS_REQUIRED|requires at least one API key/
  )
})

test("healthz answers without a credential and never reveals sessions of others", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)])
  try {
    const response = await fetch(
      `http://127.0.0.1:${harness.server.port}/healthz`
    )
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      status: "ok",
      sessions: 0,
      inFlight: 0
    })
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
    assert.equal(response.headers.get("x-frame-options"), "DENY")
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(
      response.headers.get("content-security-policy"),
      "default-src 'none'; frame-ancestors 'none'"
    )
    assert.equal(response.headers.get("access-control-allow-origin"), null)
  } finally {
    await harness.server.close()
  }
})

test("an unauthenticated MCP request is rejected and audited", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)])
  try {
    const response = await fetch(harness.server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    })
    assert.equal(response.status, 401)
    assert.match(response.headers.get("www-authenticate") ?? "", /Bearer/)

    const denied = harness.sink.events.filter(
      event => event.name === "http.authenticate"
    )
    assert.equal(denied.length, 1)
    assert.equal(denied[0]?.kind, "session")
    assert.equal(denied[0]?.outcome, "denied")
    assert.equal(denied[0]?.errorCode, "API_KEY_INVALID")
    // A failed authentication has no known actor, so it must not be attributed
    // to the operator's own OS user.
    assert.deepEqual(denied[0]?.principal, { id: "unknown", source: "unknown" })
  } finally {
    await harness.server.close()
  }
})

test("a browser Origin header is rejected unless it is allowlisted", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)])
  try {
    const blocked = await fetch(harness.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        origin: "https://evil.example.com"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    })
    assert.equal(blocked.status, 403)
    assert.ok(harness.sink.events.some(
      event => event.name === "http.origin" && event.errorCode === "ORIGIN_NOT_ALLOWED"
    ))
  } finally {
    await harness.server.close()
  }
})

test("an allowlisted Origin receives CORS headers", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)], {
    allowedOrigins: ["https://ide.example.com"]
  })
  try {
    const response = await fetch(harness.server.url, {
      method: "OPTIONS",
      headers: { origin: "https://ide.example.com" }
    })
    assert.equal(response.status, 204)
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://ide.example.com"
    )
    assert.equal(response.headers.get("access-control-expose-headers"), "mcp-session-id")
  } finally {
    await harness.server.close()
  }
})

test("rate limiting returns 429 with Retry-After and an audit record", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)], {
    rateLimitPerPrincipal: 1
  })
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {}
    })
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`
    }
    await fetch(harness.server.url, { method: "POST", headers, body })
    const limited = await fetch(harness.server.url, { method: "POST", headers, body })

    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get("retry-after")) >= 1)
    assert.equal(limited.headers.get("ratelimit-limit"), "1")
    assert.ok(harness.sink.events.some(
      event => event.name === "http.rate_limit" &&
        event.errorCode === "RATE_LIMIT_EXCEEDED" &&
        event.principal.id === "alice"
    ))
  } finally {
    await harness.server.close()
  }
})

test("a non-initialize request without a session id is rejected", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)])
  try {
    const response = await fetch(harness.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    })
    assert.equal(response.status, 400)
  } finally {
    await harness.server.close()
  }
})

test("an unknown session id is rejected with 404", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)])
  try {
    const response = await fetch(harness.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "mcp-session-id": "00000000-0000-4000-8000-000000000000"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    })
    assert.equal(response.status, 404)
  } finally {
    await harness.server.close()
  }
})

test("a viewer session advertises only read-only tools over HTTP", async () => {
  const viewerKey = generateApiKey()
  const adminKey = generateApiKey()
  const harness = await startHarness([
    keyRecord("viewer-user", "viewer", viewerKey),
    keyRecord("admin-user", "admin", adminKey)
  ])
  try {
    const viewer = await connectClient(harness, viewerKey)
    const viewerTools = (await viewer.listTools()).tools
    const admin = await connectClient(harness, adminKey)
    const adminTools = (await admin.listTools()).tools

    assert.ok(viewerTools.length > 0)
    assert.ok(viewerTools.every(tool => tool.annotations?.readOnlyHint === true))
    assert.ok(viewerTools.some(tool => tool.name === "sap.system.list"))
    assert.equal(viewerTools.some(tool => tool.name === "sap.source.patch"), false)
    assert.ok(adminTools.length > viewerTools.length)
    assert.ok(adminTools.some(tool => tool.name === "sap.transport.release"))

    await viewer.close()
    await admin.close()
  } finally {
    await harness.server.close()
  }
})

test("a developer session hides admin-only tools but keeps ordinary writes", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("dev-user", "developer", key)])
  try {
    const client = await connectClient(harness, key)
    const names = new Set((await client.listTools()).tools.map(tool => tool.name))

    assert.ok(names.has("sap.source.patch"))
    assert.ok(names.has("sap.source.activate"))
    for (const adminOnly of ADMIN_ONLY_V1_TOOLS) {
      assert.equal(names.has(adminOnly), false, `${adminOnly} must be admin-only`)
    }
    await client.close()
  } finally {
    await harness.server.close()
  }
})

test("a tool call over HTTP is audited with the session principal", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "developer", key)])
  try {
    const client = await connectClient(harness, key)
    await client.callTool({ name: "sap.system.list", arguments: {} })
    await client.close()

    const toolEvents = harness.sink.events.filter(event => event.kind === "tool")
    assert.equal(toolEvents.length, 1)
    assert.equal(toolEvents[0]?.name, "sap.system.list")
    assert.equal(toolEvents[0]?.outcome, "succeeded")
    assert.deepEqual(toolEvents[0]?.principal, { id: "alice", source: "api-key" })
    assert.ok(harness.sink.events.some(
      event => event.name === "http.session.open" && event.outcome === "succeeded"
    ))
  } finally {
    await harness.server.close()
  }
})

test("a session id cannot be replayed under a different API key", async () => {
  const aliceKey = generateApiKey()
  const bobKey = generateApiKey()
  const harness = await startHarness([
    keyRecord("alice", "developer", aliceKey),
    keyRecord("bob", "developer", bobKey)
  ])
  try {
    const initialize = await fetch(harness.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${aliceKey}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "replay-test", version: "1.0.0" }
        }
      })
    })
    const sessionId = initialize.headers.get("mcp-session-id")
    assert.ok(sessionId, "initialize must return a session id")

    const replayed = await fetch(harness.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${bobKey}`,
        "mcp-session-id": sessionId
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    })

    assert.equal(replayed.status, 403)
    assert.ok(harness.sink.events.some(
      event => event.name === "http.session.bind" &&
        event.errorCode === "SESSION_PRINCIPAL_MISMATCH" &&
        event.principal.id === "bob"
    ))
  } finally {
    await harness.server.close()
  }
})

test("the session limit is enforced and audited", async () => {
  const key = generateApiKey()
  const harness = await startHarness([keyRecord("alice", "viewer", key)], {
    maxSessions: 1
  })
  try {
    const first = await connectClient(harness, key)
    assert.equal(harness.server.sessionCount(), 1)

    const rejected = await fetch(harness.server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "overflow", version: "1.0.0" }
        }
      })
    })

    assert.equal(rejected.status, 503)
    assert.ok(harness.sink.events.some(
      event => event.name === "http.session.open" &&
        event.errorCode === "SESSION_LIMIT_REACHED"
    ))
    await first.close()
  } finally {
    await harness.server.close()
  }
})
