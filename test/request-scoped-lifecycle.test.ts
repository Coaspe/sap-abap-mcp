import assert from "node:assert/strict"
import test from "node:test"
import type { ConnectionManager } from "../src/connection-manager.js"
import type { SapClient } from "../src/sap-client.js"
import { RequestScopedConnectionProvider } from "../src/http/request-scoped-connections.js"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test("closing during profile lookup prevents creation of a late user connection", async () => {
  const lookup = deferred<boolean>()
  let created = 0
  const provider = new RequestScopedConnectionProvider({
    usesRequestScopedCredentials: () => lookup.promise,
    createBearerClient: async () => { created++; return {} as SapClient }
  } as unknown as ConnectionManager, "fixture-token")
  const pending = provider.getClient("DEV100")
  const rejected = assert.rejects(pending, /session is closed/)
  await provider.close()
  lookup.resolve(true)
  await rejected
  assert.equal(created, 0)
  await assert.rejects(provider.getClient("DEV100"), /session is closed/)
  await assert.rejects(provider.listConnections(), /session is closed/)
})

test("closing waits for pending login, logs out once, and never returns the closed client", async () => {
  const login = deferred<SapClient>()
  const started = deferred<void>()
  let logouts = 0
  const provider = new RequestScopedConnectionProvider({
    usesRequestScopedCredentials: async () => true,
    createBearerClient: () => { started.resolve(); return login.promise }
  } as unknown as ConnectionManager, "fixture-token")
  const pending = provider.getClient("DEV100")
  const rejected = assert.rejects(pending, /session is closed/)
  await started.promise
  const closing = provider.close()
  assert.equal(provider.close(), closing)
  login.resolve({ logout: async () => { logouts++ } } as unknown as SapClient)
  await Promise.all([closing, rejected])
  await provider.close()
  assert.equal(logouts, 1)
})
