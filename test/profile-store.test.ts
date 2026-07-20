import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ProfileStore } from "../src/profile-store.js"

test("ProfileStore normalizes and persists SAP profiles without secrets", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)

  const profile = await store.upsert({
    id: "dev-100",
    url: "https://sap.example.test/",
    client: "100",
    language: "en",
    username: "DEVELOPER",
    allowedPackages: ["z_demo"]
  })

  assert.deepEqual(profile, {
    id: "DEV-100",
    url: "https://sap.example.test",
    client: "100",
    language: "EN",
    environment: "development",
    authType: "basic",
    username: "DEVELOPER",
    allowedPackages: ["Z_DEMO"]
  })
  assert.deepEqual(await new ProfileStore(directory).get("dev-100"), profile)

  const storedText = await readFile(store.filePath, "utf8")
  assert.equal(storedText.includes("password"), false)
  if (process.platform !== "win32") {
    assert.equal((await stat(store.filePath)).mode & 0o777, 0o600)
  }
})

test("ProfileStore removes a profile", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  await store.upsert({ id: "DEV", url: "https://sap.example.test", client: "001" })

  assert.equal(await store.remove("dev"), true)
  assert.equal(await store.remove("dev"), false)
  assert.deepEqual(await store.list(), [])
})

test("ProfileStore persists OAuth client metadata without changing the basic default", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-profile-oauth-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)

  const profile = await store.upsert({
    id: "btp-dev",
    url: "https://abap.example.test",
    client: "100",
    authType: "oauth_client_credentials",
    tokenUrl: "https://auth.example.test/oauth/token",
    clientId: "mcp-client",
    scope: "abap.read abap.write"
  })

  assert.deepEqual(profile, {
    id: "BTP-DEV",
    url: "https://abap.example.test",
    client: "100",
    language: "EN",
    environment: "development",
    authType: "oauth_client_credentials",
    tokenUrl: "https://auth.example.test/oauth/token",
    clientId: "mcp-client",
    scope: "abap.read abap.write",
    allowedPackages: []
  })
  const storedText = await readFile(store.filePath, "utf8")
  assert.equal(storedText.includes("clientSecret"), false)
  assert.equal(storedText.includes("access_token"), false)
})

test("ProfileStore rejects OAuth token URLs containing embedded credentials or query data", async () => {
  const store = new ProfileStore("/unused")
  await assert.rejects(store.upsert({
    id: "BTP",
    url: "https://abap.example.test",
    client: "100",
    authType: "oauth_client_credentials",
    tokenUrl: "https://client:secret@auth.example.test/oauth/token?secret=value",
    clientId: "mcp-client"
  }))
})
