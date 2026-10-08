import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
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
    allowDataQueries: false,
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
    allowDataQueries: false,
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

test("ProfileStore persists an explicit development data-query opt-in", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-profile-query-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)

  const profile = await store.upsert({
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    allowDataQueries: true
  })

  assert.equal(profile.allowDataQueries, true)
  assert.equal((await new ProfileStore(directory).get("DEV100")).allowDataQueries, true)
})

test("ProfileStore rejects production data-query opt-in", async () => {
  const store = new ProfileStore("/unused")

  await assert.rejects(store.upsert({
    id: "PRD100",
    url: "https://sap.example.test",
    client: "100",
    environment: "production",
    allowDataQueries: true
  }), error =>
    typeof error === "object" && error !== null && "code" in error &&
    error.code === "DATA_QUERY_PRODUCTION_FORBIDDEN"
  )
})


test("explicit read-only policies use profile format 2 and version 1 cannot silently carry the policy", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-readonly-format-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ProfileStore(directory)
  await store.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100" })
  assert.equal(JSON.parse(await readFile(store.filePath, "utf8")).version, 1)
  await store.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", readOnly: true })
  const data = JSON.parse(await readFile(store.filePath, "utf8"))
  assert.equal(data.version, 2)
  assert.equal((await store.get("DEV100")).readOnly, true)
  await writeFile(store.filePath, JSON.stringify({ ...data, version: 1 }))
  await assert.rejects(store.list(), { code: "PROFILE_FILE_INVALID" })
})
