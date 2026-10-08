import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ConnectionManager } from "../src/connection-manager.js"
import { RequestScopedConnectionProvider } from "../src/http/request-scoped-connections.js"
import type { OAuthAccessTokenProvider } from "../src/oauth-client-credentials.js"
import { ProfileStore } from "../src/profile-store.js"
import type { SapClient, SapCredential } from "../src/sap-client.js"
import type { SecretStore } from "../src/secret-store.js"
import { OAuthAuthorizationCodeProvider } from "../src/oauth-authorization-code.js"
import { saveProfileCredential } from "../src/save-profile-credential.js"

class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()
  async get(id: string) { return this.values.get(id) }
  async set(id: string, value: string) { this.values.set(id, value) }
  async delete(id: string) { this.values.delete(id) }
}

class FakeTokenProvider implements OAuthAccessTokenProvider {
  needsRefresh = false
  invalidated = false
  async getAccessToken() { return "access-token" }
  refreshRequired() { return this.needsRefresh }
  invalidate() { this.invalidated = true }
}

test("MCP request tokens never create direct SAP bearer clients or report usable passthrough credentials", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-token-boundary-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const legacy = await profiles.upsert({ id: "RAW100", url: "https://sap.example.test", client: "100", authType: "bearer_passthrough", readOnly: true })
  await profiles.upsert({ id: "BTP100", url: "https://sap.example.test", client: "100", authType: "btp_destination",
    destinationName: "SAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" })
  let created = 0
  const manager = new ConnectionManager(profiles, { async get() { throw new Error("No local credential read allowed") }, async set() {}, async delete() {} },
    () => { created++; throw new Error("MCP token reached SAP factory") })
  const provider = new RequestScopedConnectionProvider(manager, "private.jwt.fixture")
  t.after(() => provider.close())
  await assert.rejects(provider.getClient("RAW100"), { code: "TOKEN_PASSTHROUGH_REFUSED" })
  await assert.rejects(manager.createBearerClient("RAW100", "private.jwt.fixture"), { code: "TOKEN_PASSTHROUGH_REFUSED" })
  await assert.rejects(manager.getClient("RAW100"), { code: "TOKEN_PASSTHROUGH_REFUSED" })
  const connections = await provider.listConnections()
  assert.equal(connections.find(item => item.id === "RAW100")?.credentialAvailable, false)
  assert.equal(connections.find(item => item.id === "BTP100")?.credentialAvailable, true)
  assert.equal(created, 0)
  assert.deepEqual(await profiles.get("RAW100"), legacy)
})

test("changing a Destination profile to passthrough during lookup cannot forward the MCP token", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-token-profile-race-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", authType: "btp_destination",
    destinationName: "SAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" })
  const get = profiles.get.bind(profiles)
  let lookups = 0
  profiles.get = async id => {
    const profile = await get(id)
    if (++lookups === 1) await profiles.upsert({ ...profile, authType: "bearer_passthrough" })
    return profile
  }
  let created = 0
  const manager = new ConnectionManager(profiles, new MemorySecretStore(), () => { created++; throw new Error("Unexpected SAP creation") })
  const provider = new RequestScopedConnectionProvider(manager, "private.jwt.fixture")
  await assert.rejects(provider.getClient("DEV100"), { code: "TOKEN_PASSTHROUGH_REFUSED" })
  assert.equal(created, 0)
  assert.equal(lookups, 2)
  await provider.close()
})

for (const delay of ["network", "storage", "saved-login"] as const) {
  test(`browser OAuth renewal keeps the newest credential after a delayed ${delay} operation`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "sap-oauth-renewal-race-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const profiles = new ProfileStore(directory)
    const profile = await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100",
      authType: "oauth_authorization_code", authorizationUrl: "https://login.example.test/authorize",
      tokenUrl: "https://login.example.test/token", clientId: "desktop", readOnly: true })
    const encoded = (name: string, expiresAt: number) => JSON.stringify({ version: 1,
      accessToken: name, refreshToken: name + "-refresh", expiresAt })
    const secrets = new MemorySecretStore()
    await secrets.set(profile.id, encoded("original", 1))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    t.after(release)
    const set = secrets.set.bind(secrets)
    secrets.set = async (id, credential) => {
      if (delay === "storage" && credential.includes('"accessToken":"rotated"')) {
        started(); await gate
      }
      await set(id, credential)
    }
    let provider!: OAuthAuthorizationCodeProvider
    const manager = new ConnectionManager(profiles, secrets,
      clientProfile => ({ profile: clientProfile, async login() {}, async logout() {} }) as unknown as SapClient,
      undefined, undefined, (auth, credential, persistCredential) => {
        provider = new OAuthAuthorizationCodeProvider({ authorizationUrl: auth.authorizationUrl,
          tokenUrl: auth.tokenUrl, clientId: auth.clientId, ...(auth.scope ? { scope: auth.scope } : {}) }, credential, { now: () => 10000,
          fetch: async () => {
            if (delay !== "storage") { started(); await gate }
            return new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh", expires_in: 3600 }))
          }, persistCredential })
        return provider
      })
    t.after(() => manager.close())
    await manager.getClient(profile.id)
    const refresh = provider.getAccessToken().then(token => ({ token }), error => ({ error }))
    await waiting
    const replacement = encoded("new-login", 9999999999999)
    const saved = saveProfileCredential(profiles, secrets, profile, replacement)
    if (delay !== "storage") {
      await saved
      if (delay === "network") await manager.disconnectProfile(profile.id)
      release()
      const outcome = await refresh
      assert.ok("error" in outcome)
      assert.equal(outcome.error.code, "CANCELLED")
    } else {
      await new Promise<void>(resolve => setImmediate(resolve))
      release()
      await Promise.all([refresh, saved])
      await manager.disconnectProfile(profile.id)
    }
    assert.equal(await secrets.get(profile.id), replacement)
    assert.equal((await profiles.get(profile.id)).readOnly, true)
  })
}

test("credential renewal disconnects only the saved profile and reopens with current credentials", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-renewal-connection-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const secrets = new MemorySecretStore()
  for (const id of ["DEV100", "OTHER100"]) {
    await profiles.upsert({ id, url: "https://sap.example.test", client: "100", username: "FIXTURE", readOnly: true })
    await secrets.set(id, "original")
  }
  const credentials: SapCredential[] = []
  const loggedOut: string[] = []
  const manager = new ConnectionManager(profiles, secrets, (profile, credential) => {
    credentials.push(credential)
    return { profile, async login() {}, async logout() { loggedOut.push(profile.id) } } as unknown as SapClient
  })
  t.after(() => manager.close())
  const original = await manager.getClient("DEV100")
  const other = await manager.getClient("OTHER100")
  await secrets.set("DEV100", "renewed")
  assert.equal(await manager.getClient("DEV100"), original, "Saving a secret alone does not clear the client cache")
  await manager.disconnectProfile(" dev100 ")
  assert.deepEqual(loggedOut, ["DEV100"])
  assert.equal(await manager.getClient("OTHER100"), other)
  const refreshed = await manager.getClient("DEV100")
  assert.notEqual(refreshed, original)
  assert.deepEqual(credentials[2], { type: "basic", password: "renewed" })
  assert.equal(refreshed.profile.readOnly, true)
  await manager.disconnectProfile("MISSING100")
  assert.deepEqual(loggedOut, ["DEV100"])
})

test("ConnectionManager recreates an OAuth ADT client before its bearer token expires", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-oauth-connection-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const profile = await profiles.upsert({
    id: "BTP100",
    url: "https://abap.example.test",
    client: "100",
    authType: "oauth_client_credentials",
    tokenUrl: "https://auth.example.test/oauth/token",
    clientId: "mcp-client"
  })
  const secrets = new MemorySecretStore()
  await secrets.set(profile.id, "client-secret")
  const providers: FakeTokenProvider[] = []
  const clients: Array<SapClient & { loginCount: number; logoutCount: number }> = []
  const credentials: SapCredential[] = []
  const manager = new ConnectionManager(
    profiles,
    secrets,
    (clientProfile, credential) => {
      credentials.push(credential)
      let loginCount = 0
      let logoutCount = 0
      const client = {
        profile: clientProfile,
        get loginCount() { return loginCount },
        get logoutCount() { return logoutCount },
        async login() { loginCount += 1 },
        async logout() { logoutCount += 1 },
        async getSystemInfo() { throw new Error("not used") }
      } as unknown as SapClient & { loginCount: number; logoutCount: number }
      clients.push(client)
      return client
    },
    undefined,
    () => {
      const provider = new FakeTokenProvider()
      providers.push(provider)
      return provider
    }
  )

  const first = await manager.getClient("BTP100")
  assert.equal(await manager.getClient("BTP100"), first)
  assert.equal(clients[0]?.loginCount, 1)
  assert.equal(credentials[0]?.type, "bearer")

  providers[0]!.needsRefresh = true
  const second = await manager.getClient("BTP100")
  assert.notEqual(second, first)
  assert.equal(providers[0]?.invalidated, true)
  assert.equal(clients[0]?.logoutCount, 1)
  assert.equal(clients[1]?.loginCount, 1)

  await manager.close()
  assert.equal(clients[1]?.logoutCount, 1)
})

test("legacy bearer-passthrough profiles remain readable but cannot forward a request token", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-passthrough-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({
    id: "USER100",
    url: "https://abap.example.test",
    client: "100",
    authType: "bearer_passthrough"
  })
  const secrets = new MemorySecretStore()
  let credential: SapCredential | undefined
  const manager = new ConnectionManager(profiles, secrets, (profile, value) => {
    credential = value
    return {
      profile,
      async login() {},
      async logout() {}
    } as unknown as SapClient
  })

  await assert.rejects(() => manager.getClient("USER100"), { code: "TOKEN_PASSTHROUGH_REFUSED" })
  await assert.rejects(manager.createBearerClient("USER100", "person-token"), { code: "TOKEN_PASSTHROUGH_REFUSED" })
  assert.equal(credential, undefined)
})

test("request-scoped provider closes only Destination clients", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-request-scoped-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({
    id: "SHARED100",
    url: "https://abap.example.test",
    client: "100",
    username: "DEVELOPER"
  })
  await profiles.upsert({
    id: "USER100",
    url: "https://abap.example.test",
    client: "100",
    authType: "btp_destination", destinationName: "SAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange"
  })
  const secrets = new MemorySecretStore()
  await secrets.set("SHARED100", "shared-password")
  const clients: Array<SapClient & { logoutCount: number }> = []
  const manager = new ConnectionManager(profiles, secrets, (profile) => {
    let logoutCount = 0
    const client = {
      profile,
      get logoutCount() { return logoutCount },
      async login() {},
      async logout() { logoutCount += 1 }
    } as unknown as SapClient & { logoutCount: number }
    clients.push(client)
    return client
  })
  const provider = new RequestScopedConnectionProvider(manager, "person-token")

  const shared = await manager.getClient("SHARED100") as SapClient & { logoutCount: number }
  assert.equal(await provider.getClient("SHARED100"), shared)
  const scoped = await provider.getClient("USER100") as SapClient & { logoutCount: number }

  await provider.close()
  assert.equal(shared.logoutCount, 0)
  assert.equal(scoped.logoutCount, 1)

  await manager.close()
  assert.equal(shared.logoutCount, 1)
})

test("concurrent OAuth refreshes share one replacement while the old session logs out", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-oauth-refresh-race-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const profile = await profiles.upsert({ id: "BTP100", url: "https://abap.example.test", client: "100",
    authType: "oauth_client_credentials", tokenUrl: "https://auth.example.test/token", clientId: "mcp" })
  profiles.get = async () => profile
  const secrets = new MemorySecretStore()
  await secrets.set(profile.id, "secret")
  const providers: FakeTokenProvider[] = []
  const clients: SapClient[] = []
  let releaseLogout!: () => void
  const logoutGate = new Promise<void>(resolve => { releaseLogout = resolve })
  let logouts = 0
  let failNextLogin = false
  const failure = new Error("replacement login failed")
  const manager = new ConnectionManager(profiles, secrets, clientProfile => {
    const index = clients.length
    const client = { profile: clientProfile, async login() {
      if (failNextLogin) { failNextLogin = false; throw failure }
    }, async logout() {
      logouts++
      if (index === 0) await logoutGate
    } } as unknown as SapClient
    clients.push(client)
    return client
  }, undefined, () => {
    const provider = new FakeTokenProvider()
    providers.push(provider)
    return provider
  })
  t.after(async () => { releaseLogout(); await manager.close() })
  await manager.getClient(profile.id)
  providers[0]!.needsRefresh = true
  const waiting = Array.from({ length: 8 }, () => manager.getClient(profile.id))
  await new Promise<void>(resolve => setImmediate(resolve))
  const createdBeforeLogout = clients.length
  releaseLogout()
  const replacements = await Promise.all(waiting)
  assert.equal(createdBeforeLogout, 1, "Replacement waits for old session cleanup")
  assert.equal(clients.length, 2, "Exactly one replacement is created")
  assert.ok(replacements.every(client => client === clients[1]))
  assert.equal(await manager.getClient(profile.id), clients[1])
  assert.equal(logouts, 1)
  providers[1]!.needsRefresh = true
  failNextLogin = true
  const failed = await Promise.allSettled(Array.from({ length: 8 }, () => manager.getClient(profile.id)))
  assert.ok(failed.every(result => result.status === "rejected" && result.reason === failure))
  assert.equal(clients.length, 3)
  const recovered = await manager.getClient(profile.id)
  assert.equal(recovered, clients[3])
  assert.equal(await manager.getClient(profile.id), recovered)
})

for (const fails of [false, true]) {
  test(`credential validation keeps refreshed OAuth credentials in memory when SAP ${fails ? "rejects" : "accepts"} the candidate`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "sap-oauth-validation-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const profiles = new ProfileStore(directory)
    const profile = await profiles.upsert({ id: "OAUTH100", url: "https://sap.example.test", client: "100",
      authType: "oauth_authorization_code", tokenUrl: "https://login.example.test/oauth/token",
      authorizationUrl: "https://login.example.test/oauth/authorize", clientId: "desktop" })
    const secrets = new MemorySecretStore()
    await secrets.set(profile.id, "original-credential")
    let logouts = 0
    const manager = new ConnectionManager(profiles, secrets, (_profile, credential) => ({
      async login() { assert.equal(credential.type, "bearer"); if (credential.type === "bearer") await credential.fetchToken() },
      async getSystemInfo() {
        assert.equal(await secrets.get(profile.id), "original-credential")
        if (fails) throw new Error("SAP rejected candidate")
        return {}
      },
      async logout() { logouts++ }
    } as unknown as SapClient), undefined, undefined, (_profile, _credential, persist) => ({
      async getAccessToken() { await persist("rotated-credential"); return "access" },
      refreshRequired() { return false }, invalidate() {}
    }))
    let verified: string | undefined
    const validation = manager.validateCredentials(profile, "candidate", value => { verified = value })
    if (fails) await assert.rejects(validation, /SAP rejected candidate/)
    else await validation
    assert.equal(verified, fails ? undefined : "rotated-credential")
    assert.equal(await secrets.get(profile.id), "original-credential")
    assert.equal(logouts, 1)
  })
}

test("credential validation cleans up an ADT client after failed login", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-login-cleanup-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const profile = await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", username: "USER" })
  let logouts = 0
  const manager = new ConnectionManager(profiles, new MemorySecretStore(), () => ({
    async login() { throw new Error("login rejected") }, async logout() { logouts++ }
  } as unknown as SapClient))
  await assert.rejects(manager.validateCredentials(profile, "candidate"), /login rejected/)
  assert.equal(logouts, 1)
})
