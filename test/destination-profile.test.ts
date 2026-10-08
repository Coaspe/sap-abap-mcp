import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { ProfileStore } from "../src/profile-store.js"
import { ConnectionManager } from "../src/connection-manager.js"
import { RequestScopedConnectionProvider } from "../src/http/request-scoped-connections.js"
import type { SapClient } from "../src/sap-client.js"

test("profile CLI refuses new token-passthrough configuration and preserves existing saved profiles", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-passthrough-migration-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const legacy = await profiles.upsert({ id: "OLD100", url: "https://sap.example.test", client: "100", authType: "bearer_passthrough", readOnly: true })
  const run = promisify(execFile)
  for (const id of ["NEW100", "OLD100"]) {
    await assert.rejects(run(process.execPath, ["dist/src/index.js", "profile", "add", id, "--url", "https://sap.example.test", "--client", "100", "--auth-type", "bearer-passthrough"],
      { env: { ...process.env, SAP_ABAP_MCP_HOME: directory } }), /TOKEN_PASSTHROUGH_REFUSED/)
  }
  const env = { ...process.env, SAP_ABAP_MCP_HOME: directory }
  const status = JSON.parse((await run(process.execPath, ["dist/src/index.js", "auth", "status", "OLD100"], { env })).stdout)
  assert.equal(status.credentialSource, "unsupported_passthrough")
  assert.equal(status.credentialAvailable, false)
  await assert.rejects(run(process.execPath, ["dist/src/index.js", "auth", "login", "OLD100"], { env }), /TOKEN_PASSTHROUGH_REFUSED/)
  assert.deepEqual(await profiles.list(), [legacy])
})

test("BTP profile CLI stores explicit destination policy and rejects local login", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-destination-cli-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const run = promisify(execFile)
  const args = ["dist/src/index.js", "profile", "add", "BTP100", "--url", "https://sap.example.test", "--client", "100",
    "--auth-type", "btp-destination", "--destination-name", "ABAP_DEV", "--destination-auth", "OAuth2UserTokenExchange"]
  const options = { env: { ...process.env, SAP_ABAP_MCP_HOME: directory } }
  await run(process.execPath, args, options)
  const stored = await new ProfileStore(directory).get("BTP100")
  assert.equal(stored.authType, "btp_destination")
  if (stored.authType !== "btp_destination") throw new Error("Wrong profile type")
  assert.equal(stored.destinationName, "ABAP_DEV")
  assert.equal(stored.destinationAuthentication, "OAuth2UserTokenExchange")
  const status = JSON.parse((await run(process.execPath, ["dist/src/index.js", "auth", "status", "BTP100"], options)).stdout)
  assert.equal(status.credentialSource, "http_oidc")
  assert.equal(status.localCredentialRequired, false)
  await assert.rejects(run(process.execPath, ["dist/src/index.js", "doctor", "BTP100"], {
    env: { ...options.env, VCAP_SERVICES: "{}" }
  }), error => {
    const result = error as Error & { code: number; stdout: string }
    assert.equal(result.code, 2)
    const report = JSON.parse(result.stdout)
    assert.equal(report.scope, "local_configuration_only")
    assert.equal(report.connectionVerified, false)
    return true
  })
  await assert.rejects(run(process.execPath, ["dist/src/index.js", "auth", "login", "BTP100"], options), /OIDC-authenticated HTTP/)
  await assert.rejects(run(process.execPath, [...args, "--login"], options), /OIDC-authenticated HTTP/)
  const profiles = new ProfileStore(directory)
  await assert.rejects(profiles.upsert({ ...stored, url: "http://sap.example.test" }))
  await profiles.upsert({ ...stored, url: "http://virtual-sap:8000", destinationAuthentication: "PrincipalPropagation" })
})

test("BTP connections belong to the authenticated scope and cannot enter the shared pool", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-destination-manager-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({ id: "BTP100", url: "https://sap.example.test", client: "100", authType: "btp_destination",
    destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" })
  const tokens: string[] = []
  const loggedOut: string[] = []
  const manager = new ConnectionManager(profiles, {
    get: async () => { throw new Error("Request-scoped connections must not read stored passwords") },
    set: async () => {}, delete: async () => {}
  }, (_profile, credential, transportFactory) => {
    assert.ok(transportFactory)
    assert.equal(credential.type, "bearer")
    let token = ""
    return {
      profile: _profile,
      async login() {
        if (credential.type === "bearer") token = await credential.fetchToken()
        tokens.push(token)
      },
      async logout() { loggedOut.push(token) }
    } as unknown as SapClient
  })
  await assert.rejects(manager.getClient("BTP100"), /OIDC-authenticated HTTP/)
  const first = new RequestScopedConnectionProvider(manager, "first-user")
  const second = new RequestScopedConnectionProvider(manager, "second-user")
  const a = await first.getClient("BTP100")
  assert.equal(await first.getClient("BTP100"), a)
  assert.notEqual(await second.getClient("BTP100"), a)
  assert.deepEqual(tokens, ["first-user", "second-user"])
  await first.close()
  assert.deepEqual(loggedOut, ["first-user"])
  await second.close()
  await manager.close()
  assert.deepEqual(loggedOut, ["first-user", "second-user"])
})

test("BTP discovery reports the authenticated HTTP credential without reading local passwords", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-destination-discovery-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({ id: "BTP100", url: "https://sap.example.test", client: "100", authType: "btp_destination",
    destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" })
  const manager = new ConnectionManager(profiles, {
    async get() { throw new Error("Request-scoped profiles have no local password") },
    async set() {}, async delete() {}
  })
  assert.equal((await manager.listConnections())[0]?.credentialAvailable, false)
  const scoped = new RequestScopedConnectionProvider(manager, "verified-caller-token")
  assert.equal((await scoped.listConnections())[0]?.credentialAvailable, true)
  await scoped.close()
})

test("a failed request-scoped SAP login is logged out before a clean retry", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-destination-failed-login-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  await profiles.upsert({ id: "BTP100", url: "https://sap.example.test", client: "100", authType: "btp_destination",
    destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" })
  let attempt = 0
  const loggedOut: number[] = []
  const manager = new ConnectionManager(profiles, { get: async () => undefined, set: async () => {}, delete: async () => {} }, profile => {
    const id = ++attempt
    return { profile, async login() { if (id === 1) throw new Error("SAP login denied") }, async logout() { loggedOut.push(id) } } as unknown as SapClient
  })
  const scoped = new RequestScopedConnectionProvider(manager, "verified-caller-token")
  await assert.rejects(scoped.getClient("BTP100"), /SAP login denied/)
  assert.deepEqual(loggedOut, [1])
  await scoped.getClient("BTP100")
  await scoped.close()
  assert.deepEqual(loggedOut, [1, 2])
  assert.equal(attempt, 2)
})

test("saved access policy changes reach cached direct and HTTP clients without another login", async t => {
  for (const authType of ["basic", "btp_destination"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "sap-policy-refresh-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const profiles = new ProfileStore(directory)
    const profile = await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", authType,
      username: "USER", readOnly: false, allowedPackages: ["Z_OLD"],
      ...(authType === "btp_destination" ? { destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" as const } : {}) })
    let logins = 0
    const manager = new ConnectionManager(profiles, { get: async () => "fixture", set: async () => {}, delete: async () => {} },
      current => ({ profile: current, async login() { logins++ }, async logout() {} }) as unknown as SapClient)
    const scoped = authType === "btp_destination" ? new RequestScopedConnectionProvider(manager, "verified-user-token") : undefined
    const connections = scoped ?? manager
    const client = await connections.getClient("DEV100")
    await profiles.upsert({ ...profile, readOnly: true, allowedPackages: ["Z_NEW"], allowDataQueries: false })
    assert.equal(await connections.getClient("DEV100"), client)
    assert.equal(client.profile.readOnly, true)
    assert.deepEqual(client.profile.allowedPackages, ["Z_NEW"])
    await profiles.upsert({ ...profile, readOnly: false, allowedPackages: ["Z_EXPLICIT"] })
    assert.equal(await connections.getClient("DEV100"), client)
    assert.equal(client.profile.readOnly, false)
    assert.deepEqual(client.profile.allowedPackages, ["Z_EXPLICIT"])
    assert.equal(logins, 1)
    await scoped?.close()
    await manager.close()
  }
})
