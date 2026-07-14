import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
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

