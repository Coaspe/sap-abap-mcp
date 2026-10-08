import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { get, createServer } from "node:http"
import { spawn, execFile } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { discoverOAuthProtectedResourceMetadata, extractWWWAuthenticateParams, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createMcpServer } from "../src/mcp-server.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import { hashApiKey } from "../src/http/auth.js"
import { createOidcAuthenticator, JwksKeyStore, type OidcAuthenticator } from "../src/http/oidc.js"
import { startHttpMcpServer, type HttpServerOptions } from "../src/http/server.js"

const issuer = "https://issuer.example.test/tenant"
const resource = "https://mcp.example.test/sap/mcp"
const metadataPath = "/.well-known/oauth-protected-resource/sap/mcp"
type DiscoveryOptions = Omit<HttpServerOptions, "oidc"> & { oauthResourceUrl?: string; oidc?: OidcAuthenticator & { issuer?: string } }
const start = (configuration: DiscoveryOptions) => startHttpMcpServer(configuration)

function options(): DiscoveryOptions {
  return { apiKeys: [], port: 0, log: () => undefined, oauthResourceUrl: resource,
    oidc: { issuer, async resolve() { throw new Error("Invalid fixture token") } },
    createMcpServerForSession: () => ({ server: createMcpServer({} as never, resolveServeToolSelection("v1", undefined, "minimal")) }) }
}

test("OIDC resource metadata is public, stable and creates no SAP/MCP session", async t => {
  let resolved = 0
  let created = 0
  const configuration = options()
  configuration.oidc = { issuer, async resolve() { resolved++; throw new Error("No authentication needed") } }
  configuration.createMcpServerForSession = () => { created++; throw new Error("No session needed") }
  const running = await start(configuration)
  t.after(() => running.close())
  const origin = new URL(running.url).origin
  for (const path of [metadataPath, "/.well-known/oauth-protected-resource"]) {
    const response = await fetch(origin + path, { headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http" } })
    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type") ?? "", /application\/json/)
    assert.deepEqual(await response.json(), { resource, authorization_servers: [issuer], bearer_methods_supported: ["header"] })
  }
  const head = await fetch(origin + metadataPath, { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
  const refused = await fetch(origin + metadataPath, { method: "POST", body: "{}" })
  assert.equal(refused.status, 405)
  assert.equal(running.sessionCount(), 0)
  assert.equal(resolved, 0)
  assert.equal(created, 0)
})

test("missing and invalid tokens challenge with a discoverable fixed URL exposed to allowed origins", async t => {
  const running = await start({ ...options(), allowedOrigins: ["https://ide.example.test"] })
  t.after(() => running.close())
  for (const authorization of [undefined, "Bearer invalid.jwt.fixture"]) {
    const response = await fetch(running.url, { headers: { origin: "https://ide.example.test", ...(authorization ? { authorization } : {}) } })
    assert.equal(response.status, 401)
    const challenge = extractWWWAuthenticateParams(response)
    assert.equal(challenge.resourceMetadataUrl?.href, "https://mcp.example.test" + metadataPath)
    if (authorization) assert.equal(challenge.error, "invalid_token")
    assert.match(response.headers.get("access-control-expose-headers") ?? "", /www-authenticate/i)
    assert.doesNotMatch(await response.text(), /fixture|issuer|attacker/)
  }
})

test("metadata retains host and browser-origin restrictions", async t => {
  const running = await start({ ...options(), allowedHosts: ["127.0.0.1"] })
  t.after(() => running.close())
  const url = new URL(running.url).origin + metadataPath
  const response = await fetch(url, { headers: { origin: "https://attacker.example" } })
  assert.equal(response.status, 403)
  assert.doesNotMatch(await response.text(), /authorization_servers/)
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(url, { headers: { host: "attacker.example" } }, incoming => {
      incoming.resume(); incoming.once("end", () => resolve(incoming.statusCode))
    }).once("error", reject)
  })
  assert.equal(status, 403)
})

test("API-key-only and legacy OIDC servers do not advertise invented OAuth discovery", async t => {
  for (const oidc of [undefined, options().oidc]) {
    const configuration: HttpServerOptions = { apiKeys: [{ id: "fixture", role: "viewer", keySha256: hashApiKey("fixture") }],
      port: 0, log: () => undefined, createMcpServerForSession: options().createMcpServerForSession, ...(oidc ? { oidc } : {}) }
    const running = await startHttpMcpServer(configuration)
    t.after(() => running.close())
    assert.equal((await fetch(new URL(running.url).origin + metadataPath)).status, 404)
    assert.equal(extractWWWAuthenticateParams(await fetch(running.url)).resourceMetadataUrl, undefined)
  }
})

test("OAuth discovery refuses unsafe URLs and missing trusted issuer before listening", async () => {
  const invalid = ["http://mcp.example.test/mcp", "https://user:secret@mcp.example.test/mcp", "https://mcp.example.test/mcp?token=x",
    "https://mcp.example.test/mcp#fragment", "https://mcp.example.test/mcp#", "not-a-url"]
  for (const oauthResourceUrl of invalid) {
    await assert.rejects(async () => { const running = await start({ ...options(), oauthResourceUrl }); await running.close() }, { code: "OAUTH_DISCOVERY_CONFIG_INVALID" })
  }
  const base = options()
  const { oidc: _oidc, ...withoutOidc } = base
  await assert.rejects(async () => { const running = await start({ ...withoutOidc,
    apiKeys: [{ id: "fixture", role: "viewer", keySha256: hashApiKey("fixture") }] }); await running.close() }, { code: "OAUTH_DISCOVERY_CONFIG_INVALID" })
  await assert.rejects(async () => { const running = await start({ ...base, oidc: { issuer: "https://issuer.example.test/?x=1",
    async resolve() { throw new Error("unused") } } }); await running.close() }, { code: "OAUTH_DISCOVERY_CONFIG_INVALID" })
})

for (const publicPath of ["/mcp", "/sap/mcp"]) {
  test(`SDK discovers protected metadata without a challenge for ${publicPath}`, async t => {
    const publicUrl = "https://mcp.example.test" + publicPath
    const running = await start({ ...options(), oauthResourceUrl: publicUrl })
    t.after(() => running.close())
    const metadata = await discoverOAuthProtectedResourceMetadata(publicUrl, undefined,
      async (input, init) => fetch(new URL(new URL(String(input)).pathname, running.url), init))
    assert.equal(metadata.resource, publicUrl)
    assert.deepEqual(metadata.authorization_servers, [issuer])
  })
}

test("real SDK follows discovery and PKCE, then initializes with an audience-bound signed JWT", async t => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const token = (audience = resource, expiresAt = Math.floor(Date.now() / 1000) + 300) => {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const payload = encoded({ alg: "RS256", kid: "fixture" }) + "." + encoded({ iss: issuer, aud: audience, sub: "fixture-user", exp: expiresAt })
    return payload + "." + sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")
  }
  const authenticator = createOidcAuthenticator({ issuer, audience: resource, jwksUri: issuer + "/keys" },
    new JwksKeyStore(issuer + "/keys", 300000, async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture", alg: "RS256" }] })))
  const running = await start({ ...options(), oidc: authenticator })
  t.after(() => running.close())
  for (const credential of [token("https://different.example.test/mcp"), token(resource, 1)]) {
    const refused = await fetch(running.url, { headers: { authorization: "Bearer " + credential } })
    assert.equal(refused.status, 401)
    assert.equal(extractWWWAuthenticateParams(refused).resourceMetadataUrl?.href, "https://mcp.example.test" + metadataPath)
  }
  let redirected: URL | undefined
  let verifier = ""
  let tokens: Awaited<ReturnType<OAuthClientProvider["tokens"]>>
  let exchanges = 0
  const provider: OAuthClientProvider = {
    redirectUrl: "http://127.0.0.1:12345/callback",
    clientMetadata: { redirect_uris: ["http://127.0.0.1:12345/callback"], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" },
    clientInformation: () => ({ client_id: "pre-registered-fixture" }), tokens: () => tokens,
    saveTokens: value => { tokens = value }, saveCodeVerifier: value => { verifier = value }, codeVerifier: () => verifier,
    redirectToAuthorization: url => { redirected = url }, state: () => "fixture-state"
  }
  const transportOptions: NonNullable<ConstructorParameters<typeof StreamableHTTPClientTransport>[1]> = { authProvider: provider,
    fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.origin === "https://mcp.example.test") {
        return fetch(new URL(url.pathname === "/sap/mcp" ? "/mcp" : url.pathname, running.url), init)
      }
      if (url.href === "https://issuer.example.test/.well-known/oauth-authorization-server/tenant") {
        return Response.json({ issuer, authorization_endpoint: issuer + "/authorize", token_endpoint: issuer + "/token",
          response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] })
      }
      assert.equal(url.href, issuer + "/token")
      exchanges++
      const body = new URLSearchParams(String(init?.body))
      assert.equal(body.get("resource"), resource)
      assert.equal(body.get("code"), "fixture-code")
      assert.equal(body.get("client_id"), "pre-registered-fixture")
      assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), redirected?.searchParams.get("code_challenge"))
      return Response.json({ access_token: token(), token_type: "Bearer", expires_in: 300 })
    } }
  const transport = new StreamableHTTPClientTransport(new URL(resource), transportOptions)
  const first = new Client({ name: "oauth-discovery-first", version: "1" })
  const clientTransport = transport as unknown as Parameters<Client["connect"]>[0]
  await assert.rejects(first.connect(clientTransport), /Unauthorized/)
  assert.equal(redirected?.origin, "https://issuer.example.test")
  assert.equal(redirected?.searchParams.get("resource"), resource)
  assert.equal(redirected?.searchParams.get("code_challenge_method"), "S256")
  assert.equal(redirected?.searchParams.get("state"), "fixture-state")
  await transport.finishAuth("fixture-code")
  await first.close()
  const client = new Client({ name: "oauth-discovery-authenticated", version: "1" })
  t.after(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), transportOptions) as unknown as Parameters<Client["connect"]>[0])
  assert.equal((await client.listTools()).tools.length, 5)
  assert.equal(exchanges, 1)
  assert.equal(running.sessionCount(), 1)
})

test("CLI accepts the public resource URL flag or environment only with HTTP OIDC", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-http-oauth-cli-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SAP_")))
  const env = { ...environment, SAP_ABAP_MCP_HOME: directory }
  await assert.rejects(promisify(execFile)(process.execPath, ["dist/src/index.js", "serve", "--oauth-resource-url", resource], { env, timeout: 5000 }), /OPTION_CONFLICT/)
  await assert.rejects(promisify(execFile)(process.execPath, ["dist/src/index.js", "serve", "--http", "--oidc-issuer", issuer,
    "--oidc-audience", resource, "--oauth-resource-url"], { env, timeout: 5000 }), /OPTION_REQUIRED/)
  for (const setting of ["flag", "environment"]) {
    const reserved = createServer()
    reserved.listen(0, "127.0.0.1")
    await once(reserved, "listening")
    const address = reserved.address()
    assert.ok(address && typeof address === "object")
    await new Promise<void>((resolve, reject) => reserved.close(error => error ? reject(error) : resolve()))
    const child = spawn(process.execPath, ["dist/src/index.js", "serve", "--http", "--oidc-issuer", issuer,
      "--oidc-audience", resource, "--port", String(address.port), ...(setting === "flag" ? ["--oauth-resource-url", resource] : [])], {
      env: { ...env, ...(setting === "environment" ? { SAP_ABAP_MCP_OAUTH_RESOURCE_URL: resource } : {}) }, stdio: ["ignore", "ignore", "pipe"] })
    const exited = once(child, "exit")
    const close = async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exited }
    t.after(close)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CLI startup timed out")), 10000)
      let diagnostic = ""
      child.stderr.on("data", chunk => {
        diagnostic += String(chunk)
        if (diagnostic.includes(`http://127.0.0.1:${address.port}/mcp`)) { clearTimeout(timer); resolve() }
      })
      child.once("exit", () => { clearTimeout(timer); reject(new Error("CLI exited before listening")) })
      child.once("error", error => { clearTimeout(timer); reject(error) })
    })
    const response = await fetch(`http://127.0.0.1:${address.port}${metadataPath}`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).resource, resource)
    await close()
  }
})
