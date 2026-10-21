import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { AppError } from "../src/errors.js"
import { addProfile } from "../src/index.js"
import { ProfileStore } from "../src/profile-store.js"
import type { SecretStore } from "../src/secret-store.js"

class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  async get(profileId: string): Promise<string | undefined> {
    return this.values.get(profileId)
  }

  async set(profileId: string, secret: string): Promise<void> {
    this.values.set(profileId, secret)
  }

  async delete(profileId: string): Promise<void> {
    this.values.delete(profileId)
  }
}

test("profile add login validates before storing the profile and password", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-cli-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const secrets = new MemorySecretStore()
  let validated = false

  const result = await addProfile(
    {
      id: "dev100",
      url: "https://sap.example.test/",
      client: "100",
      username: "DEVELOPER"
    },
    profiles,
    secrets,
    {
      password: "secret",
      async validateCredentials(profile, password) {
        validated = true
        assert.equal(profile.id, "DEV100")
        assert.equal(profile.url, "https://sap.example.test")
        assert.equal(password, "secret")
      }
    }
  )

  assert.equal(validated, true)
  assert.equal(result.credentialStored, true)
  assert.deepEqual(await profiles.get("DEV100"), result.profile)
  assert.equal(await secrets.get("DEV100"), "secret")
})

test("profile add login failure preserves the existing profile and password", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-cli-profile-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const secrets = new MemorySecretStore()
  const existing = await profiles.upsert({
    id: "DEV100",
    url: "https://old.example.test",
    client: "100",
    username: "OLD_USER"
  })
  await secrets.set("DEV100", "old-secret")

  await assert.rejects(
    addProfile(
      {
        id: "DEV100",
        url: "https://new.example.test",
        client: "100",
        username: "NEW_USER"
      },
      profiles,
      secrets,
      {
        password: "wrong-secret",
        async validateCredentials() {
          throw new AppError("LOGIN_FAILED", "Invalid credentials")
        }
      }
    ),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "LOGIN_FAILED"
  )

  assert.deepEqual(await profiles.get("DEV100"), existing)
  assert.equal(await secrets.get("DEV100"), "old-secret")
})

test("profile add login accepts OAuth client credentials without a SAP username", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-cli-oauth-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profiles = new ProfileStore(directory)
  const secrets = new MemorySecretStore()

  const result = await addProfile(
    {
      id: "btp100",
      url: "https://abap.example.test",
      client: "100",
      authType: "oauth_client_credentials",
      tokenUrl: "https://auth.example.test/oauth/token",
      clientId: "mcp-client"
    },
    profiles,
    secrets,
    {
      password: "client-secret",
      async validateCredentials(profile, secret) {
        assert.equal(profile.authType, "oauth_client_credentials")
        assert.equal(profile.username, undefined)
        assert.equal(secret, "client-secret")
      }
    }
  )

  assert.equal(result.profile.authType, "oauth_client_credentials")
  assert.equal(await secrets.get("BTP100"), "client-secret")
})

test("profile CLI preserves read-only scope until writes are explicitly enabled", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-readonly-cli-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const run = promisify(execFile)
  const args = ["dist/src/index.js", "profile", "add", "DEV100", "--url", "https://sap.example.test", "--client", "100", "--username", "USER"]
  const options = { env: { ...process.env, SAP_ABAP_MCP_HOME: directory } }
  await run(process.execPath, [...args, "--read-only", "--packages", "Z_SAFE"], options)
  const profiles = new ProfileStore(directory)
  assert.equal((await profiles.get("DEV100")).readOnly, true)
  await run(process.execPath, args, options)
  assert.equal((await profiles.get("DEV100")).readOnly, true)
  assert.deepEqual((await profiles.get("DEV100")).allowedPackages, ["Z_SAFE"])
  await run(process.execPath, [...args, "--allow-writes"], options)
  assert.equal((await profiles.get("DEV100")).readOnly, false)
  assert.deepEqual((await profiles.get("DEV100")).allowedPackages, ["Z_SAFE"])
  await assert.rejects(run(process.execPath, [...args, "--read-only", "--allow-writes"], options), /OPTION_CONFLICT/)
  assert.equal((await profiles.get("DEV100")).readOnly, false)
})

test("profile CLI adds, preserves, changes and clears validated CA paths", async t => {
  const directory = await mkdtemp(join(tmpdir(), "sap-cli-ca-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { writeFile, readFile } = await import("node:fs/promises")
  const { testCertificate } = await import("./helpers/certificates.js")
  const fixture = testCertificate()
  const ca = join(directory, "company.pem")
  await writeFile(ca, fixture.cert)
  const run = promisify(execFile)
  const args = ["dist/src/index.js", "profile", "add", "DEV", "--url", "https://sap.example.test", "--client", "100"]
  const options = { env: { ...process.env, SAP_ABAP_MCP_HOME: directory } }
  await run(process.execPath, [...args, "--ca-file", ca], options)
  const profiles = new ProfileStore(directory)
  assert.equal((await profiles.get("DEV")).caFile, ca)
  assert.equal(JSON.parse(await readFile(profiles.filePath, "utf8")).version, 3)
  await run(process.execPath, args, options)
  assert.equal((await profiles.get("DEV")).caFile, ca)
  const second = join(directory, "second.pem"); await writeFile(second, fixture.cert)
  await run(process.execPath, ["dist/src/index.js", "profile", "edit", "DEV", "--ca-file", second], options)
  assert.equal((await profiles.get("DEV")).caFile, second)
  const invalid = join(directory, "key.pem"); await writeFile(invalid, fixture.key)
  await assert.rejects(run(process.execPath, ["dist/src/index.js", "profile", "edit", "DEV", "--ca-file", invalid], options), /CA_FILE_INVALID/)
  assert.equal((await profiles.get("DEV")).caFile, second)
  await run(process.execPath, ["dist/src/index.js", "profile", "edit", "DEV", "--clear-ca-file"], options)
  assert.equal((await profiles.get("DEV")).caFile, undefined)
})
