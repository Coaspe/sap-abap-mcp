import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { AppError } from "../src/errors.js"
import { abapGitCredentialKey } from "../src/abapgit-credentials.js"
import { ProfileStore, type SapProfile } from "../src/profile-store.js"
import { MemorySecretStore } from "../src/secret-store.js"
import {
  runSetupWizard,
  runSetupRemoval,
  type SetupChoice,
  type SetupPrompter
} from "../src/setup-wizard.js"

class ScriptedPrompter implements SetupPrompter {
  readonly output: string[] = []
  readonly labels: string[] = []

  constructor(private readonly answers: Array<string | boolean>) {}

  async input(label: string, defaultValue?: string): Promise<string> {
    this.labels.push(label)
    const answer = this.next()
    assert.equal(typeof answer, "string")
    return (answer as string) || defaultValue || ""
  }

  async select(
    label: string,
    _choices: readonly SetupChoice[],
    _defaultValue: string
  ): Promise<string> {
    this.labels.push(label)
    const answer = this.next()
    assert.equal(typeof answer, "string")
    return answer as string
  }

  async confirm(label: string, _defaultValue: boolean): Promise<boolean> {
    this.labels.push(label)
    const answer = this.next()
    assert.equal(typeof answer, "boolean")
    return answer as boolean
  }

  async secret(label: string): Promise<string> {
    this.labels.push(label)
    const answer = this.next()
    assert.equal(typeof answer, "string")
    return answer as string
  }

  write(message: string): void {
    this.output.push(message)
  }

  close(): void {}

  private next(): string | boolean {
    const answer = this.answers.shift()
    assert.notEqual(answer, undefined, "scripted prompt answer is missing")
    return answer as string | boolean
  }
}

async function setupStores(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-setup-wizard-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return {
    profiles: new ProfileStore(directory),
    secrets: new MemorySecretStore()
  }
}

test("setup wizard creates and verifies a server using beginner-facing labels", async t => {
  const { profiles, secrets } = await setupStores(t)
  const prompter = new ScriptedPrompter([
    "dev100",
    "https://sap.example.test/",
    "100",
    "DEVELOPER",
    "EN",
    "development",
    "Z_TEST,Z_SHARED",
    true,
    "secret"
  ])
  let validated: SapProfile | undefined

  const result = await runSetupWizard({
    profiles,
    secrets,
    prompter,
    platform: "darwin",
    async validateCredentials(profile, password) {
      validated = profile
      assert.equal(password, "secret")
    }
  })

  assert.deepEqual(result, {
    status: "ready",
    serverName: "DEV100",
    sapUrl: "https://sap.example.test"
  })
  assert.equal(validated?.id, "DEV100")
  assert.deepEqual(await profiles.get("DEV100"), {
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    language: "EN",
    environment: "development",
    authType: "basic",
    username: "DEVELOPER",
    allowedPackages: ["Z_TEST", "Z_SHARED"]
  })
  assert.equal(await secrets.get("DEV100"), "secret")
  assert.ok(prompter.labels.includes("Server name"))
  assert.ok(prompter.labels.includes("SAP URL"))
  assert.ok(prompter.labels.every(label => !/Profile ID|System/.test(label)))
  assert.match(prompter.output.join("\n"), /Server name: DEV100/)
  assert.match(prompter.output.join("\n"), /SAP URL: https:\/\/sap\.example\.test/)
})

test("setup edit targets one server and keeps its name fixed", async t => {
  const { profiles, secrets } = await setupStores(t)
  await profiles.upsert({
    id: "DEV100",
    url: "https://old.example.test",
    client: "100",
    username: "OLD_USER"
  })
  await secrets.set("DEV100", "old-secret")
  const prompter = new ScriptedPrompter([
    "https://new.example.test",
    "200",
    "NEW_USER",
    "EN",
    "quality",
    "Z_NEW",
    true,
    "new-secret"
  ])

  const result = await runSetupWizard({
    profiles,
    secrets,
    prompter,
    platform: "win32",
    mode: "edit",
    serverName: "dev100",
    async validateCredentials(profile, password) {
      assert.equal(profile.id, "DEV100")
      assert.equal(password, "new-secret")
    }
  })

  assert.deepEqual(result, {
    status: "ready",
    serverName: "DEV100",
    sapUrl: "https://new.example.test"
  })
  assert.ok(!prompter.labels.includes("Server name"))
  assert.deepEqual(await profiles.get("DEV100"), {
    id: "DEV100",
    url: "https://new.example.test",
    client: "200",
    language: "EN",
    environment: "quality",
    authType: "basic",
    username: "NEW_USER",
    allowedPackages: ["Z_NEW"]
  })
  assert.equal(await secrets.get("DEV100"), "new-secret")
})

test("setup remove deletes the selected server and all stored credentials", async t => {
  const { profiles, secrets } = await setupStores(t)
  await profiles.upsert({
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    username: "DEVELOPER"
  })
  await secrets.set("DEV100", "sap-secret")
  await secrets.set(abapGitCredentialKey("DEV100"), "git-secret")
  const prompter = new ScriptedPrompter(["DEV100", true])

  const result = await runSetupRemoval({ profiles, secrets, prompter })

  assert.deepEqual(result, { status: "removed", serverName: "DEV100" })
  assert.deepEqual(await profiles.list(), [])
  assert.equal(await secrets.get("DEV100"), undefined)
  assert.equal(await secrets.get(abapGitCredentialKey("DEV100")), undefined)
  assert.match(prompter.output.join("\n"), /SAP URL: https:\/\/sap\.example\.test/)
})

test("setup remove cancellation preserves the server and credentials", async t => {
  const { profiles, secrets } = await setupStores(t)
  await profiles.upsert({
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100"
  })
  await secrets.set("DEV100", "sap-secret")
  const prompter = new ScriptedPrompter([false])

  const result = await runSetupRemoval({
    profiles,
    secrets,
    prompter,
    serverName: "DEV100"
  })

  assert.deepEqual(result, { status: "cancelled" })
  assert.equal((await profiles.get("DEV100")).id, "DEV100")
  assert.equal(await secrets.get("DEV100"), "sap-secret")
  assert.match(prompter.output.join("\n"), /No changes were made/)
})

test("setup wizard uses an existing server as defaults and preserves it on login failure", async t => {
  const { profiles, secrets } = await setupStores(t)
  const existing = await profiles.upsert({
    id: "DEV100",
    url: "https://old.example.test",
    client: "100",
    username: "OLD_USER"
  })
  await secrets.set("DEV100", "old-secret")
  const prompter = new ScriptedPrompter([
    "DEV100",
    "",
    "https://new.example.test",
    "",
    "NEW_USER",
    "",
    "development",
    "",
    true,
    "wrong-secret"
  ])

  await assert.rejects(
    runSetupWizard({
      profiles,
      secrets,
      prompter,
      platform: "win32",
      async validateCredentials() {
        throw new AppError("LOGIN_FAILED", "Invalid credentials")
      }
    }),
    error => typeof error === "object" && error !== null &&
      "code" in error && error.code === "LOGIN_FAILED"
  )

  assert.deepEqual(await profiles.get("DEV100"), existing)
  assert.equal(await secrets.get("DEV100"), "old-secret")
})

test("setup wizard cancellation leaves profiles unchanged", async t => {
  const { profiles, secrets } = await setupStores(t)
  const prompter = new ScriptedPrompter([
    "DEV100",
    "https://sap.example.test",
    "100",
    "DEVELOPER",
    "EN",
    "development",
    "",
    false
  ])

  const result = await runSetupWizard({
    profiles,
    secrets,
    prompter,
    platform: "darwin",
    async validateCredentials() {
      assert.fail("cancelled setup must not validate credentials")
    }
  })

  assert.deepEqual(result, { status: "cancelled" })
  assert.deepEqual(await profiles.list(), [])
  assert.match(prompter.output.join("\n"), /No changes were saved/)
})

test("setup wizard explains Linux environment authentication without collecting a password", async t => {
  const { profiles, secrets } = await setupStores(t)
  const prompter = new ScriptedPrompter([
    "dev-100",
    "https://sap.example.test",
    "100",
    "DEVELOPER",
    "EN",
    "development",
    "",
    true
  ])

  const result = await runSetupWizard({
    profiles,
    secrets,
    prompter,
    platform: "linux",
    async validateCredentials() {
      assert.fail("Linux without an environment password cannot validate credentials")
    }
  })

  assert.deepEqual(result, {
    status: "authentication-required",
    serverName: "DEV-100",
    environmentVariable: "SAP_ABAP_MCP_PASSWORD_DEV_100"
  })
  assert.ok(prompter.labels.every(label => label !== "SAP password"))
  assert.match(prompter.output.join("\n"), /SAP_ABAP_MCP_PASSWORD_DEV_100/)
  assert.equal((await profiles.get("DEV-100")).url, "https://sap.example.test")
})

test("setup wizard preserves an OAuth profile and redirects it to the explicit CLI", async t => {
  const { profiles, secrets } = await setupStores(t)
  const existing = await profiles.upsert({
    id: "BTP100",
    url: "https://abap.example.test",
    client: "100",
    authType: "oauth_client_credentials",
    tokenUrl: "https://auth.example.test/oauth/token",
    clientId: "mcp-client"
  })
  const prompter = new ScriptedPrompter(["BTP100"])

  await assert.rejects(
    runSetupWizard({
      profiles,
      secrets,
      prompter,
      platform: "darwin",
      async validateCredentials() {
        assert.fail("OAuth profile must not be changed by the Basic Auth wizard")
      }
    }),
    error => error instanceof AppError && error.code === "PROFILE_AUTH_TYPE_UNSUPPORTED"
  )
  assert.deepEqual(await profiles.get("BTP100"), existing)
})
