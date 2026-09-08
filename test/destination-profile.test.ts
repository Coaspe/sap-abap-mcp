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
