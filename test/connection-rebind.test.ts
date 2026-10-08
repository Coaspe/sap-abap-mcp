import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ConnectionManager } from "../src/connection-manager.js"
import { RequestScopedConnectionProvider } from "../src/http/request-scoped-connections.js"
import { ProfileStore, type SapProfileInput } from "../src/profile-store.js"
import type { SapClient } from "../src/sap-client.js"

const directChanges: Record<string, Partial<SapProfileInput>> = {
  "SAP URL": { url: "https://other.example.test" },
  "SAP client": { client: "200" },
  "language": { language: "DE" },
  "username": { username: "NEW_USER" },
  "classic bridge": { classicBridgePath: "/sap/new_bridge" },
  "authentication type": { authType: "basic" },
  "token URL": { tokenUrl: "https://new-login.example.test/token" },
  "OAuth client": { clientId: "new-app" },
  "scope": { scope: "new-scope" },
  "authorization URL": { authorizationUrl: "https://new-login.example.test/authorize" }
}
const destinationChanges: Record<string, Partial<SapProfileInput>> = {
  "SAP URL": { url: "https://other.example.test" },
  "SAP client": { client: "200" },
  "language": { language: "DE" },
  "classic bridge": { classicBridgePath: "/sap/new_bridge" },
  "Destination name": { destinationName: "ABAP_NEW" },
  "Destination authentication": { destinationAuthentication: "PrincipalPropagation" }
}

for (const scoped of [false, true]) {
  for (const [field, change] of Object.entries(scoped ? destinationChanges : directChanges)) {
    test(`${scoped ? "HTTP Destination" : "direct"} connection reopens after changing ${field}`, async t => {
      const directory = await mkdtemp(join(tmpdir(), "sap-connection-rebind-"))
      t.after(() => rm(directory, { recursive: true, force: true }))
      const profiles = new ProfileStore(directory)
      const profile = await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", username: "USER",
        ...(scoped ? { authType: "btp_destination" as const, destinationName: "ABAP_DEV", destinationAuthentication: "OAuth2UserTokenExchange" as const }
          : { authType: "oauth_authorization_code" as const, authorizationUrl: "https://login.example.test/authorize", tokenUrl: "https://login.example.test/token", clientId: "app" }) })
      await profiles.upsert({ ...profile, id: "OTHER100" })
      const loggedOut: SapClient[] = []
      let logins = 0
      let invalidations = 0
      const manager = new ConnectionManager(profiles, { get: async () => "fixture", set: async () => {}, delete: async () => {} },
        current => {
          const client = { profile: current, async login() { logins++ }, async logout() { loggedOut.push(client as unknown as SapClient) } }
          return client as unknown as SapClient
        }, undefined, undefined, () => ({ async getAccessToken() { return "fixture-token" }, refreshRequired() { return false }, invalidate() { invalidations++ } }))
      const provider = scoped ? new RequestScopedConnectionProvider(manager, "verified-caller-token") : manager
      t.after(async () => { if (scoped) await provider.close(); await manager.close() })
      const first = await provider.getClient("DEV100")
      const other = await provider.getClient("OTHER100")
      const changed = await profiles.upsert({ ...profile, ...change })
      const reopened = await provider.getClient("dev100")
      assert.notEqual(reopened, first, "Next operation must use the saved SAP target and login context")
      assert.deepEqual(reopened.profile, changed)
      assert.deepEqual(loggedOut, [first])
      assert.equal(invalidations, scoped ? 0 : 1)
      assert.equal(await provider.getClient("OTHER100"), other)
      assert.equal(await provider.getClient("DEV100"), reopened)
      assert.equal(logins, 3)
    })
  }
}
