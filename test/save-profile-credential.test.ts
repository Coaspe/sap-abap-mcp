import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProfileStore } from "../src/profile-store.js"
import { MemorySecretStore } from "../src/secret-store.js"
import { saveProfileCredential } from "../src/save-profile-credential.js"
import { AppError } from "../src/errors.js"

const input = { id: "dev100", url: "https://sap.example.test", client: "100", username: "OLD" }
async function stores(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "sap-profile-save-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { profiles: new ProfileStore(directory), secrets: new MemorySecretStore() }
}

test("credential write failure never publishes a changed profile", async t => {
  const { profiles, secrets } = await stores(t)
  const previous = await profiles.upsert(input)
  await secrets.set("DEV100", "old")
  secrets.set = async () => { throw new Error("Keychain unavailable") }
  await assert.rejects(saveProfileCredential(profiles, secrets, { ...input, username: "NEW" }, "new"), /Keychain unavailable/)
  assert.deepEqual(await profiles.get("DEV100"), previous)
  assert.equal(await secrets.get("DEV100"), "old")
})

test("profile write failure restores an existing secret or removes a newly stored secret", async t => {
  for (const previous of [undefined, "old"] as const) {
    const { profiles, secrets } = await stores(t)
    if (previous !== undefined) await secrets.set("DEV100", previous)
    profiles.upsert = async () => { throw new Error("Profile directory read-only") }
    await assert.rejects(saveProfileCredential(profiles, secrets, input, "new"), /Profile directory read-only/)
    assert.equal(await secrets.get("DEV100"), previous)
    assert.deepEqual(await profiles.list(), [])
  }
})

test("failed compensation explicitly requires recovery without exposing credential values", async t => {
  const { profiles, secrets } = await stores(t)
  await secrets.set("DEV100", "sensitive-old")
  profiles.upsert = async () => { throw new Error("disk failed") }
  const set = secrets.set.bind(secrets)
  secrets.set = async (id, value) => {
    if (value === "sensitive-old") throw new Error("sensitive-old storage error")
    await set(id, value)
  }
  await assert.rejects(saveProfileCredential(profiles, secrets, input, "sensitive-new"), (error: unknown) => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, "PROFILE_CREDENTIAL_RECOVERY_REQUIRED")
    assert.doesNotMatch(error.message, /sensitive/)
    return true
  })
})

test("failed profile update rolls back before the next login without blocking another profile", async t => {
  const { profiles, secrets } = await stores(t)
  await profiles.upsert(input)
  await secrets.set("DEV100", "old")
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  t.after(release)
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const upsert = profiles.upsert.bind(profiles)
  profiles.upsert = async value => {
    if (value.username === "FAILED") {
      started(); await gate
      throw new Error("Profile write failed")
    }
    return upsert(value)
  }
  const failed = assert.rejects(saveProfileCredential(profiles, secrets, { ...input, username: "FAILED" }, "failed"), /Profile write failed/)
  await waiting
  const saved = saveProfileCredential(profiles, secrets, { ...input, id: " DEV100 ", username: "CURRENT" }, "current")
  await saveProfileCredential(profiles, secrets, { ...input, id: "OTHER100", username: "OTHER" }, "other")
  assert.equal(await secrets.get("OTHER100"), "other")
  assert.equal(await secrets.get("DEV100"), "failed", "The next login must wait for rollback")
  release()
  await Promise.all([failed, saved])
  assert.equal(await secrets.get("DEV100"), "current")
  assert.equal((await profiles.get("DEV100")).username, "CURRENT")
})
