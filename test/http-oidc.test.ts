import assert from "node:assert/strict"
import { constants, generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { AuditRecorder, type AuditEvent, type AuditSink } from "../src/audit-log.js"
import {
  generateApiKey,
  generateApiKeyPepper,
  hashApiKey,
  hmacApiKey,
  isWellFormedApiKey,
  parseApiKeyFile,
  resolveApiKeyPrincipal
} from "../src/http/auth.js"
import { trimTrailingLineBreaks, trimTrailingSlashes } from "../src/text.js"
import {
  JwksKeyStore,
  claimValues,
  createOidcAuthenticator,
  parseOidcRoleMap,
  resolveTokenRole,
  verifyJwt,
  type OidcConfiguration,
  type SupportedJwtAlgorithm
} from "../src/http/oidc.js"
import { ScopedConnectionProvider } from "../src/http/scoped-connections.js"
import { startHttpMcpServer } from "../src/http/server.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AbapToolService } from "../src/tool-service.js"
import { ConnectionManager } from "../src/connection-manager.js"
import { RequestScopedConnectionProvider } from "../src/http/request-scoped-connections.js"
import { ProfileStore } from "../src/profile-store.js"
import { SourceCache } from "../src/source-cache.js"
import { AppError } from "../src/errors.js"
import type { SapClient } from "../src/sap-client.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import { toAdtResourceUri } from "../src/mcp/v1/resource-uri.js"

const ISSUER = "https://idp.example.com"
const AUDIENCE = "sap-abap-mcp"
const NOW_MS = 1_800_000_000_000
const now = () => NOW_MS

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url")
}

/**
 * `assert.rejects` matches a regular expression against the error message, not
 * against an AppError code, so assert the code explicitly.
 */
function hasCode(expected: string): (error: unknown) => true {
  return error => {
    const actual = (error as { code?: unknown })?.code
    assert.equal(
      actual,
      expected,
      `expected error code ${expected}, received ${String(actual)}`
    )
    return true
  }
}

interface Signer {
  keyId: string
  jwk: Record<string, unknown>
  privateKey: KeyObject
  algorithm: SupportedJwtAlgorithm
  signingName: string
  usePss?: boolean
  isEcdsa?: boolean
}

function rsaSigner(keyId = "rsa-1"): Signer {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  return {
    keyId,
    jwk: { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "RS256" },
    privateKey,
    algorithm: "RS256",
    signingName: "RSA-SHA256"
  }
}

function ecSigner(keyId = "ec-1"): Signer {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  return {
    keyId,
    jwk: { ...publicKey.export({ format: "jwk" }), kid: keyId, use: "sig", alg: "ES256" },
    privateKey,
    algorithm: "ES256",
    signingName: "SHA256",
    isEcdsa: true
  }
}

function issueToken(
  signer: Signer,
  claims: Record<string, unknown>,
  headerOverrides: Record<string, unknown> = {}
): string {
  const header = base64Url(JSON.stringify({
    alg: signer.algorithm,
    typ: "JWT",
    kid: signer.keyId,
    ...headerOverrides
  }))
  const payload = base64Url(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "alice@example.com",
    exp: Math.floor(NOW_MS / 1000) + 600,
    iat: Math.floor(NOW_MS / 1000),
    ...claims
  }))
  const input = Buffer.from(`${header}.${payload}`, "utf8")
  const signature = signer.isEcdsa
    ? sign(signer.signingName, input, { key: signer.privateKey, dsaEncoding: "ieee-p1363" })
    : signer.usePss
      ? sign(signer.signingName, input, { key: signer.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST })
      : sign(signer.signingName, input, signer.privateKey)
  return `${header}.${payload}.${base64Url(signature)}`
}

function keyStoreFor(...signers: Signer[]): JwksKeyStore {
  let fetches = 0
  const store = new JwksKeyStore(
    `${ISSUER}/.well-known/jwks.json`,
    60_000,
    async () => {
      fetches += 1
      return { keys: signers.map(signer => signer.jwk) }
    },
    now
  )
  ;(store as unknown as { fetchCount: () => number }).fetchCount = () => fetches
  return store
}

const configuration: OidcConfiguration = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: `${ISSUER}/.well-known/jwks.json`,
  roleMap: { "sap.developer": "developer", "sap.admin": "admin" }
}

for (const mode of ["minimal", "single"] as const) {
  test(`authenticated ${mode} HTTP calls refuse direct token forwarding before SAP login`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "sap-http-token-boundary-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const profiles = new ProfileStore(directory)
    await profiles.upsert({ id: "RAW100", url: "https://sap.example.test", client: "100", authType: "bearer_passthrough", readOnly: true })
    let created = 0
    const manager = new ConnectionManager(profiles, { async get() { throw new Error("No local credential lookup") }, async set() {}, async delete() {} },
      () => { created++; throw new Error("MCP token reached SAP") })
    const signer = rsaSigner()
    const token = issueToken(signer, { scope: "sap.developer" })
    const running = await startHttpMcpServer({ apiKeys: [], port: 0, log: () => undefined,
      oidc: createOidcAuthenticator(configuration, keyStoreFor(signer), now),
      createMcpServerForSession: ({ principal, sapBearerToken }) => {
        assert.ok(sapBearerToken)
        const scoped = new RequestScopedConnectionProvider(manager, sapBearerToken, principal.systemIds)
        const service = new AbapToolService(scoped)
        return { server: createMcpServer(service, { ...resolveServeToolSelection("v1", undefined, mode), role: principal.role }),
          dispose: async () => { service.dispose(); await scoped.close() } }
      } })
    t.after(() => running.close())
    const client = new Client({ name: "token-boundary", version: "1" })
    const transport = new StreamableHTTPClientTransport(new URL(running.url), { requestInit: { headers: { authorization: "Bearer " + token } } })
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0])
    t.after(() => client.close())
    const described = await client.callTool({ name: mode === "single" ? "sap" : "sap.capability.describe",
      arguments: mode === "single" ? { name: "describe", arguments: { name: "sap.system.inspect" } } : { name: "sap.system.inspect" } })
    const { data } = described.structuredContent as { data: { capability: { schemaHash: string } } }
    const result = await client.callTool({ name: mode === "single" ? "sap" : "sap.capability.invoke_read",
      arguments: { name: "sap.system.inspect", schemaHash: data.capability.schemaHash, arguments: { systemId: "RAW100" }, ...(mode === "single" ? { risk: "read" } : {}) } })
    assert.equal(result.isError, true)
    const content = result.content as Array<{ type: string, text?: string }>
    const errorText = content.find(item => item.type === "text")
    assert.ok(errorText?.text)
    const failure = (result.structuredContent ?? JSON.parse(errorText.text)) as { code: string, category: string, retryable: boolean }
    assert.equal(failure.code, "TOKEN_PASSTHROUGH_REFUSED")
    assert.equal(failure.category, "policy")
    assert.equal(failure.retryable, false)
    assert.equal(JSON.stringify(result).includes(token), false)
    assert.equal(created, 0)
  })
}

test("an RSA-signed token from the configured issuer verifies", async () => {
  const signer = rsaSigner()
  const token = issueToken(signer, { scope: "openid sap.developer" })

  const verified = await verifyJwt(token, configuration, keyStoreFor(signer), now)

  assert.equal(verified.subject, "alice@example.com")
  assert.equal(verified.role, "developer")
  assert.equal(verified.claims.iss, ISSUER)
})

test("an ECDSA-signed token verifies after JOSE-to-DER conversion", async () => {
  const signer = ecSigner()
  const token = issueToken(signer, { scope: "sap.admin" })

  const verified = await verifyJwt(token, configuration, keyStoreFor(signer), now)

  assert.equal(verified.role, "admin")
})

test("a tampered payload fails signature verification", async () => {
  const signer = rsaSigner()
  const token = issueToken(signer, { scope: "sap.developer" })
  const [header, , signature] = token.split(".")
  const forged = base64Url(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "attacker",
    exp: Math.floor(NOW_MS / 1000) + 600,
    scope: "sap.admin"
  }))

  await assert.rejects(
    () => verifyJwt(`${header}.${forged}.${signature}`, configuration, keyStoreFor(signer), now),
    hasCode("JWT_SIGNATURE_INVALID")
  )
})

test("issuer, audience, expiry, nbf, and subject are all enforced", async () => {
  const signer = rsaSigner()
  const store = keyStoreFor(signer)
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ iss: "https://evil.example.com" }, "JWT_ISSUER_MISMATCH"],
    [{ aud: "another-service" }, "JWT_AUDIENCE_MISMATCH"],
    [{ exp: Math.floor(NOW_MS / 1000) - 3600 }, "JWT_EXPIRED"],
    [{ nbf: Math.floor(NOW_MS / 1000) + 3600 }, "JWT_NOT_YET_VALID"],
    [{ sub: undefined }, "JWT_SUBJECT_REQUIRED"],
    [{ exp: undefined }, "JWT_EXPIRY_REQUIRED"]
  ]
  for (const [claims, expected] of cases) {
    const token = issueToken(signer, claims)
    await assert.rejects(
      () => verifyJwt(token, configuration, store, now),
      hasCode(expected)
    )
  }
})

test("an audience array containing the expected value is accepted", async () => {
  const signer = rsaSigner()
  const token = issueToken(signer, { aud: ["other", AUDIENCE], scope: "sap.developer" })

  const verified = await verifyJwt(token, configuration, keyStoreFor(signer), now)

  assert.equal(verified.role, "developer")
})

test("symmetric and none algorithms are refused", async () => {
  const signer = rsaSigner()
  const store = keyStoreFor(signer)
  for (const algorithm of ["HS256", "none", "RSA1_5"]) {
    const token = issueToken(signer, { scope: "sap.admin" }, { alg: algorithm })
    await assert.rejects(
      () => verifyJwt(token, configuration, store, now),
      hasCode("JWT_ALGORITHM_UNSUPPORTED")
    )
  }
})

test("a token signed by an unknown key is refused", async () => {
  const trusted = rsaSigner("trusted")
  const rogue = rsaSigner("trusted") // same kid, different key material
  const token = issueToken(rogue, { scope: "sap.admin" })

  await assert.rejects(
    () => verifyJwt(token, configuration, keyStoreFor(trusted), now),
    hasCode("JWT_SIGNATURE_INVALID")
  )

  const unknownKid = issueToken(rsaSigner("rotated-away"), { scope: "sap.admin" })
  await assert.rejects(
    () => verifyJwt(unknownKid, configuration, keyStoreFor(trusted), now),
    hasCode("JWT_KEY_UNKNOWN")
  )
})

test("malformed tokens are rejected before any key lookup", async () => {
  const store = keyStoreFor(rsaSigner())
  for (const token of ["", "a.b", "a.b.c.d", "notbase64.notbase64.sig"]) {
    await assert.rejects(() => verifyJwt(token, configuration, store, now))
  }
})

test("the JWKS store requires HTTPS outside loopback", () => {
  assert.throws(
    () => new JwksKeyStore("http://idp.example.com/jwks.json"),
    hasCode("JWKS_URI_INVALID")
  )
  assert.doesNotThrow(() => new JwksKeyStore("http://127.0.0.1:8080/jwks.json"))
})

test("role mapping takes the highest privilege and falls back to the default", () => {
  assert.deepEqual(claimValues("a b,c"), ["a", "b", "c"])
  assert.deepEqual(claimValues(["a", 1, "b"]), ["a", "b"])
  assert.deepEqual(claimValues(undefined), [])

  assert.equal(
    resolveTokenRole({ scope: "sap.developer sap.admin" }, configuration),
    "admin"
  )
  assert.equal(resolveTokenRole({ scope: "unmapped" }, configuration), "viewer")
  assert.equal(
    resolveTokenRole({ groups: ["sap.admin"] }, { ...configuration, roleClaim: "groups" }),
    "admin"
  )
  assert.equal(
    resolveTokenRole({ scope: "" }, { ...configuration, defaultRole: "developer" }),
    "developer"
  )
  assert.deepEqual(parseOidcRoleMap("a=admin,b=viewer"), { a: "admin", b: "viewer" })
  assert.throws(() => parseOidcRoleMap("broken"), hasCode("OIDC_ROLE_MAP_INVALID"))
  assert.throws(() => parseOidcRoleMap("a=root"), hasCode("INVALID_ROLE"))
})

test("the authenticator returns an oidc principal with the mapped role", async () => {
  const signer = rsaSigner()
  const authenticator = createOidcAuthenticator(
    configuration,
    keyStoreFor(signer),
    now
  )

  const principal = await authenticator.resolve(issueToken(signer, {
    scope: "sap.developer",
    preferred_username: "alice"
  }))

  assert.deepEqual(principal, {
    id: "alice@example.com",
    role: "developer",
    source: "oidc",
    username: "alice"
  })
})

test("a principal is limited to its assigned SAP profiles", async () => {
  const inner = {
    async listConnections() {
      return [
        { id: "DEV100", url: "u", client: "100", language: "EN", environment: "development" as const, credentialAvailable: true },
        { id: "QAS200", url: "u", client: "200", language: "EN", environment: "quality" as const, credentialAvailable: true }
      ]
    },
    async getClient(connectionId: string) {
      return { requested: connectionId } as never
    }
  }

  const scoped = new ScopedConnectionProvider(inner, ["dev100"])
  assert.deepEqual((await scoped.listConnections()).map(c => c.id), ["DEV100"])
  assert.deepEqual(await scoped.getClient("DEV100"), { requested: "DEV100" })
  await assert.rejects(() => scoped.getClient("QAS200"), hasCode("PROFILE_NOT_ALLOWED"))
  // The refusal must not disclose which profiles the identity may use.
  await assert.rejects(() => scoped.getClient("QAS200"), error =>
    !/DEV100/.test(String((error as Error).message)))

  // No allowlist keeps the single-identity default.
  const open = new ScopedConnectionProvider(inner)
  assert.equal((await open.listConnections()).length, 2)
  assert.deepEqual(await open.getClient("QAS200"), { requested: "QAS200" })
})

function memorySink(): AuditSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    name: "stderr",
    events,
    write: event => { events.push(event) },
    close: async () => undefined
  }
}

test("an OIDC token authenticates a real HTTP session and is audited as oidc", async () => {
  const signer = rsaSigner()
  const sink = memorySink()
  const server = await startHttpMcpServer({
    apiKeys: [],
    oidc: createOidcAuthenticator(configuration, keyStoreFor(signer), now),
    port: 0,
    log: () => undefined,
    auditRecorder: new AuditRecorder({ sink, apiVersion: "v1" }),
    createMcpServerForSession: ({ principal }) => ({
      server: createMcpServer(
        new AbapToolService({
          async listConnections() { return [] },
          async getClient() { throw new Error("unused") }
        }),
        { apiVersion: "v1", role: principal.role }
      )
    })
  })
  try {
    const token = issueToken(signer, { scope: "sap.developer" })
    const client = new Client({ name: "oidc-test", version: "1.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    })
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0])
    const names = new Set((await client.listTools()).tools.map(tool => tool.name))
    assert.ok(names.has("sap.source.patch"), "developer role must come from the token")
    assert.equal(names.has("sap.transport.release"), false)
    await client.close()

    const opened = sink.events.find(event => event.name === "http.session.open")
    assert.deepEqual(opened?.principal, {
      id: "alice@example.com",
      source: "oidc"
    })
  } finally {
    await server.close()
  }
})

test("an expired token is refused by the HTTP server and audited", async () => {
  const signer = rsaSigner()
  const sink = memorySink()
  const server = await startHttpMcpServer({
    apiKeys: [{ id: "fallback", role: "viewer", keySha256: hashApiKey(generateApiKey()) }],
    oidc: createOidcAuthenticator(configuration, keyStoreFor(signer), now),
    port: 0,
    log: () => undefined,
    auditRecorder: new AuditRecorder({ sink, apiVersion: "v1" }),
    createMcpServerForSession: () => ({
      server: createMcpServer(
        new AbapToolService({
          async listConnections() { return [] },
          async getClient() { throw new Error("unused") }
        }),
        { apiVersion: "v1" }
      )
    })
  })
  try {
    const expired = issueToken(signer, { exp: Math.floor(NOW_MS / 1000) - 7200 })
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${expired}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    })

    assert.equal(response.status, 401)
    assert.match(response.headers.get("www-authenticate") ?? "", /invalid_token/)
    assert.ok(sink.events.some(
      event => event.name === "http.authenticate" && event.errorCode === "JWT_EXPIRED"
    ))
  } finally {
    await server.close()
  }
})

test("HTTP mode still refuses to start with neither API keys nor OIDC", async () => {
  await assert.rejects(
    startHttpMcpServer({
      apiKeys: [],
      port: 0,
      log: () => undefined,
      createMcpServerForSession: () => ({
        server: createMcpServer(
          new AbapToolService({
            async listConnections() { return [] },
            async getClient() { throw new Error("unused") }
          }),
          { apiVersion: "v1" }
        )
      })
    }),
    hasCode("CLIENT_AUTH_REQUIRED")
  )
})

test("only credentials shaped like a generated key are accepted", () => {
  // A validator cannot measure entropy, so this raises the floor rather than
  // proving strength: 32 CSPRNG bytes encode to 43 base64url characters, and
  // anything shorter or outside that alphabet cannot be a generated key.
  const key = generateApiKey()
  assert.equal(key.length, 43)
  assert.equal(isWellFormedApiKey(key), true)
  // 64-character hex is also 256 bits and stays acceptable.
  assert.equal(isWellFormedApiKey("0".repeat(64)), true)
  for (const rejected of ["", "short", "a".repeat(42), `${"a".repeat(42)}+`, `${"a".repeat(42)}/`]) {
    assert.equal(isWellFormedApiKey(rejected), false, `must reject ${rejected.length} chars`)
  }
  // A rejected shape must not resolve a principal even if its digest is stored.
  const weak = "a".repeat(32)
  assert.equal(
    resolveApiKeyPrincipal(
      [{ id: "weak", role: "viewer", keySha256: hashApiKey(weak) }],
      weak
    ),
    undefined
  )
})

test("a peppered record verifies only with the server secret", () => {
  const key = generateApiKey()
  const pepper = generateApiKeyPepper()
  const record = {
    id: "alice",
    role: "developer" as const,
    keyHmacSha256: hmacApiKey(key, pepper)
  }

  assert.notEqual(record.keyHmacSha256, hashApiKey(key))
  assert.deepEqual(resolveApiKeyPrincipal([record], key, pepper), {
    id: "alice",
    role: "developer",
    source: "api-key"
  })
  // Without the secret the record cannot verify, and it must not fall back to a
  // plain hash: a missing secret has to deny access, not weaken the check.
  assert.equal(resolveApiKeyPrincipal([record], key), undefined)
  assert.equal(
    resolveApiKeyPrincipal([record], key, generateApiKeyPepper()),
    undefined
  )
  // A plain record still verifies while a secret is configured for others.
  const plain = { id: "bob", role: "viewer" as const, keySha256: hashApiKey(key) }
  assert.equal(resolveApiKeyPrincipal([plain], key, pepper)?.id, "bob")
  assert.throws(() => hmacApiKey(key, "tooshort"), hasCode("API_KEY_PEPPER_TOO_SHORT"))
})

test("a key file names its own digest algorithm", () => {
  const key = generateApiKey()
  const pepper = generateApiKeyPepper()
  const [peppered] = parseApiKeyFile(JSON.stringify({
    keys: [{ id: "alice", role: "admin", keyHmacSha256: hmacApiKey(key, pepper) }]
  }))
  assert.equal(peppered?.keyHmacSha256?.length, 64)
  assert.equal(peppered?.keySha256, undefined)

  // Exactly one digest, so a file is never ambiguous about what verifies it.
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({ keys: [{ id: "a", role: "viewer" }] })),
    /exactly one of keySha256 or keyHmacSha256/
  )
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({
      keys: [{
        id: "a",
        role: "viewer",
        keySha256: hashApiKey(key),
        keyHmacSha256: hmacApiKey(key, pepper)
      }]
    })),
    /exactly one of keySha256 or keyHmacSha256/
  )
})

test("trailing-character trimming is linear on repetition-heavy input", () => {
  assert.equal(trimTrailingSlashes("https://a.example.com///"), "https://a.example.com")
  assert.equal(trimTrailingSlashes("https://a.example.com"), "https://a.example.com")
  assert.equal(trimTrailingSlashes("///"), "")
  assert.equal(trimTrailingLineBreaks("secret\r\n\r\n"), "secret")
  assert.equal(trimTrailingLineBreaks("secret"), "secret")

  // A pattern anchored as X+$ is quadratic on this input; a backwards scan is not.
  const pathological = `https://x/${"/".repeat(200_000)}a`
  const startedAt = process.hrtime.bigint()
  assert.equal(trimTrailingSlashes(pathological), pathological)
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
  assert.ok(elapsedMs < 250, `trimming took ${elapsedMs}ms`)
})

test("an API key file carries a per-person SAP profile assignment", () => {
  const key = generateApiKey()
  const [record] = parseApiKeyFile(JSON.stringify({
    keys: [{
      id: "alice",
      role: "developer",
      keySha256: hashApiKey(key),
      systemIds: ["dev100", " qas200 "]
    }]
  }))

  assert.deepEqual(record?.systemIds, ["DEV100", "QAS200"])
  assert.deepEqual(resolveApiKeyPrincipal([record!], key), {
    id: "alice",
    role: "developer",
    source: "api-key",
    systemIds: ["DEV100", "QAS200"]
  })

  // Omitting systemIds keeps every configured profile reachable.
  const [unscoped] = parseApiKeyFile(JSON.stringify({
    keys: [{ id: "ops", role: "admin", keySha256: hashApiKey(key) }]
  }))
  assert.equal(unscoped?.systemIds, undefined)
  assert.equal(resolveApiKeyPrincipal([unscoped!], key)?.systemIds, undefined)

  assert.throws(
    () => parseApiKeyFile(JSON.stringify({
      keys: [{ id: "a", role: "viewer", keySha256: hashApiKey(key), systemIds: "DEV100" }]
    })),
    /systemIds must be an array/
  )
  assert.throws(
    () => parseApiKeyFile(JSON.stringify({
      keys: [{ id: "a", role: "viewer", keySha256: hashApiKey(key), systemIds: [] }]
    })),
    /at least one SAP profile id/
  )
})


for (const algorithm of ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"] as const) {
  test(`OIDC accepts an RFC 7518 ${algorithm} signature`, async () => {
    const ecdsa = algorithm.startsWith("ES")
    const curves = { ES256: "prime256v1", ES384: "secp384r1", ES512: "secp521r1" }
    const { privateKey, publicKey } = ecdsa
      ? generateKeyPairSync("ec", { namedCurve: curves[algorithm as keyof typeof curves] })
      : generateKeyPairSync("rsa", { modulusLength: 2048 })
    const signer: Signer = { keyId: algorithm, privateKey, algorithm, isEcdsa: ecdsa,
      usePss: algorithm.startsWith("PS"), signingName: `SHA${algorithm.slice(2)}`,
      jwk: { ...publicKey.export({ format: "jwk" }), kid: algorithm, alg: algorithm, use: "sig" } }
    const verified = await verifyJwt(issueToken(signer, { scope: "sap.developer" }), configuration, keyStoreFor(signer), now)
    assert.equal(verified.role, "developer")
    assert.equal(verified.subject, "alice@example.com")
  })
}

test("OIDC rejects RSA-PSS signatures with a salt length outside JOSE", async () => {
  const signer = rsaSigner()
  signer.algorithm = "PS256"
  signer.jwk.alg = "PS256"
  const original = issueToken(signer, {})
  const [header, payload] = original.split(".")
  for (const saltLength of [0, 20, constants.RSA_PSS_SALTLEN_MAX_SIGN]) {
    const signature = sign("SHA256", Buffer.from(`${header}.${payload}`), {
      key: signer.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength
    })
    await assert.rejects(verifyJwt(`${header}.${payload}.${signature.toString("base64url")}`, configuration, keyStoreFor(signer), now),
      hasCode("JWT_SIGNATURE_INVALID"))
  }
})

test("OIDC rejects signatures whose key type or EC curve does not match alg", async () => {
  const ec = ecSigner()
  ec.jwk.alg = "RS256"
  ec.algorithm = "RS256"
  ec.isEcdsa = false // A DER EC signature must not authenticate as an RSA algorithm.
  await assert.rejects(verifyJwt(issueToken(ec, {}), configuration, keyStoreFor(ec), now), hasCode("JWT_KEY_MISMATCH"))
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" })
  const wrongCurve: Signer = { keyId: "wrong-curve", privateKey, algorithm: "ES256", signingName: "SHA256", isEcdsa: true,
    jwk: { ...publicKey.export({ format: "jwk" }), kid: "wrong-curve", alg: "ES256" } }
  await assert.rejects(verifyJwt(issueToken(wrongCurve, {}), configuration, keyStoreFor(wrongCurve), now), hasCode("JWT_KEY_MISMATCH"))
})

test("OIDC respects signing-key alg and key_ops restrictions", async () => {
  const signer = rsaSigner()
  signer.jwk.alg = "RS512"
  await assert.rejects(verifyJwt(issueToken(signer, {}), configuration, keyStoreFor(signer), now), hasCode("JWT_KEY_UNKNOWN"))
  signer.jwk.alg = "RS256"
  signer.jwk.key_ops = ["encrypt"]
  await assert.rejects(verifyJwt(issueToken(signer, {}), configuration, keyStoreFor(signer), now), hasCode("JWT_KEY_UNKNOWN"))
})

test("OIDC rejects inherited object properties as JWT algorithms", async () => {
  const signer = rsaSigner()
  for (const alg of ["constructor", "toString", "__proto__"]) {
    await assert.rejects(verifyJwt(issueToken(signer, {}, { alg }), configuration, keyStoreFor(signer), now), hasCode("JWT_ALGORITHM_UNSUPPORTED"))
  }
})

test("concurrent OIDC HTTP scopes isolate source validators, authorization, logout and audit", { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-oidc-isolation-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({ id: "BTP100", url: "https://sap.example.test", client: "100", authType: "btp_destination",
    destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" })
  const signer = rsaSigner()
  const aliceToken = issueToken(signer, { sub: "alice", scope: "sap.developer" })
  const bobToken = issueToken(signer, { sub: "bob", scope: "sap.developer" })
  const identities = new Map([[aliceToken, "alice"], [bobToken, "bob"]])
  const sink = memorySink()
  const seen: Array<{ user: string; validator: string | undefined }> = []
  const loggedOut: string[] = []
  let denyBob = false
  let releaseReads!: () => void
  const concurrentReads = new Promise<void>(resolve => { releaseReads = resolve })
  t.after(releaseReads)
  const manager = new ConnectionManager(profiles, {
    async get() { throw new Error("HTTP scopes must not read local passwords") }, async set() {}, async delete() {}
  }, (_profile, credential, transportFactory) => {
    assert.ok(transportFactory)
    assert.equal(credential.type, "bearer")
    let user = ""
    const cache = new SourceCache(async (_uri, options) => {
      const validator = options.headers?.["If-None-Match"] as string | undefined
      seen.push({ user, validator })
      if (seen.length === 2) releaseReads()
      await concurrentReads
      if (user === "bob" && denyBob) throw new AppError("SAP_AUTHORIZATION_DENIED", "SAP permission revoked")
      return { body: validator ? "" : `REPORT z_demo.\nWRITE '${user}-private'.`,
        status: validator ? 304 : 200, statusText: "fixture", headers: { ETag: '"same-validator"' } }
    })
    return {
      profile: _profile,
      async login() {
        if (credential.type === "bearer") user = identities.get(await credential.fetchToken()) ?? ""
        assert.ok(user)
      },
      async readSourceByUri(uri: string) { return { source: await cache.read(uri), sourceUri: uri } },
      async logout() { cache.clear(); loggedOut.push(user) }
    } as unknown as SapClient
  })
  const server = await startHttpMcpServer({ apiKeys: [], port: 0, log: () => undefined,
    oidc: createOidcAuthenticator(configuration, keyStoreFor(signer), now),
    auditRecorder: new AuditRecorder({ sink, apiVersion: "v1" }),
    createMcpServerForSession: ({ principal, sapBearerToken, auditRecorder }) => {
      assert.ok(sapBearerToken)
      const connections = new RequestScopedConnectionProvider(manager, sapBearerToken, principal.systemIds)
      const service = new AbapToolService(connections)
      return { server: createMcpServer(service, { apiVersion: "v1", role: principal.role,
        ...resolveServeToolSelection("v1", undefined, "minimal"), ...(auditRecorder ? { auditRecorder } : {}) }),
        dispose: async () => { service.dispose(); await connections.close() } }
    }
  })
  t.after(() => server.close())
  const connect = async (token: string) => {
    const client = new Client({ name: "isolation-test", version: "1.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    })
    await client.connect(transport as unknown as Parameters<Client["connect"]>[0])
    t.after(() => client.close())
    assert.equal((await client.listTools()).tools.length, 5)
    const described = await client.callTool({ name: "sap.capability.describe", arguments: {
      names: ["sap.system.list", "sap.source.read"]
    } })
    const capabilities = (described.structuredContent as any).data.capabilities as Array<{ name: string; schemaHash: string }>
    const invoke = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name: "sap.capability.invoke_read", arguments: {
        name, schemaHash: capabilities.find(capability => capability.name === name)!.schemaHash, arguments: args
      } })
      const text = result.content as Array<{ type: string; text?: string }>
      return result.structuredContent ?? JSON.parse(text.find(item => item.type === "text")!.text!)
    }
    const systems = await invoke("sap.system.list", {})
    assert.equal(systems.data.systems[0].credentialAvailable, true)
    return { transport, invoke }
  }
  const [alice, bob] = await Promise.all([connect(aliceToken), connect(bobToken)])
  const args = { systemId: "BTP100", resourceUri: toAdtResourceUri("BTP100", "/sap/bc/adt/programs/programs/z_demo/source/main") }
  const [a, b] = await Promise.all([alice.invoke("sap.source.read", args), bob.invoke("sap.source.read", args)])
  assert.match(a.data.code, /alice-private/)
  assert.match(b.data.code, /bob-private/)
  assert.notEqual(a.data.contentHash, b.data.contentHash)
  const unchanged = await alice.invoke("sap.source.read", { ...args, ifNoneMatch: a.data.contentHash })
  assert.equal(unchanged.data.notModified, true)
  assert.equal(unchanged.data.code, undefined)
  assert.deepEqual(seen.find(call => call.user === "alice" && call.validator)?.validator, '"same-validator"')
  const replay = await fetch(server.url, { method: "GET", headers: {
    authorization: `Bearer ${bobToken}`, "mcp-session-id": alice.transport.sessionId!, accept: "text/event-stream"
  } })
  assert.equal(replay.status, 403)
  denyBob = true
  const denied = await bob.invoke("sap.source.read", { ...args, ifNoneMatch: b.data.contentHash })
  assert.equal(denied.code, "SAP_AUTHORIZATION_DENIED")
  assert.equal(denied.category, "authorization")
  assert.equal(denied.data, undefined)
  denyBob = false
  const recovered = await bob.invoke("sap.source.read", args)
  assert.match(recovered.data.code, /bob-private/)
  assert.equal(seen.filter(call => call.user === "bob").at(-1)?.validator, undefined)
  await alice.transport.terminateSession()
  assert.deepEqual(loggedOut, ["alice"])
  assert.match((await bob.invoke("sap.source.read", args)).data.code, /bob-private/)
  await bob.transport.terminateSession()
  assert.deepEqual(loggedOut, ["alice", "bob"])
  const reads = sink.events.filter(event => event.name === "sap.source.read")
  assert.ok(reads.some(event => event.principal.id === "alice" && event.outcome === "succeeded"))
  assert.ok(reads.some(event => event.principal.id === "bob" && event.outcome === "denied"))
  assert.doesNotMatch(JSON.stringify(sink.events), /alice-private|bob-private/)
  assert.ok(!JSON.stringify(sink.events).includes(aliceToken) && !JSON.stringify(sink.events).includes(bobToken))
})
