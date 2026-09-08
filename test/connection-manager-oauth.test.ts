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

test("bearer-passthrough creates an uncached SAP client from the request token only", async t => {
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

  await assert.rejects(() => manager.getClient("USER100"), { code: "AUTH_PASSTHROUGH_REQUIRED" })
  await manager.createBearerClient("USER100", "person-token")
  assert.equal(credential?.type, "bearer")
  assert.equal(credential?.type === "bearer" ? await credential.fetchToken() : "", "person-token")
})

test("request-scoped provider closes only passthrough clients", async t => {
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
    authType: "bearer_passthrough"
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
  const manager = new ConnectionManager(profiles, secrets, () => {
    const index = clients.length
    const client = { async login() {
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
