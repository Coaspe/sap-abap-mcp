import assert from "node:assert/strict"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import test from "node:test"
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
  type OidcConfiguration
} from "../src/http/oidc.js"
import { ScopedConnectionProvider } from "../src/http/scoped-connections.js"
import { startHttpMcpServer } from "../src/http/server.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AbapToolService } from "../src/tool-service.js"

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
  algorithm: "RS256" | "ES256" | "PS256"
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
