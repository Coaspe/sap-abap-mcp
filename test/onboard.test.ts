import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { AppError } from "../src/errors.js"
import {
  inspectOnboardStatus,
  startOnboardServer,
  type CommandResult,
  type CommandRunner
} from "../src/onboard.js"
import { ProfileStore, type SapProfile } from "../src/profile-store.js"
import { MemorySecretStore } from "../src/secret-store.js"

function result(
  stdout = "",
  overrides: Partial<CommandResult> = {}
): CommandResult {
  return {
    ok: true,
    stdout,
    stderr: "",
    missing: false,
    ...overrides
  }
}

test("onboard credential replacement preserves packages and advanced Basic settings", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  const existing = await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100",
    username: "DEVELOPER", allowedPackages: ["Z_LOCKED"], allowDataQueries: true,
    classicBridgePath: "/sap/bc/zbridge" })
  await secrets.set("DEV100", "old")
  const server = await startOnboardServer({ profiles, secrets, platform: "win32",
    homeDirectory: home, workingDirectory: cwd, runner: async () => result(),
    async validateCredentials(profile) { assert.deepEqual(profile.allowedPackages, ["Z_LOCKED"]) } })
  t.after(() => server.close())
  const url = new URL(server.url)
  const headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
  const status = await (await fetch(`${url.origin}/api/status`, { headers })).json() as any
  assert.deepEqual(status.profiles[0].allowedPackages, ["Z_LOCKED"])
  const response = await fetch(`${url.origin}/api/profile`, { method: "POST", headers,
    body: JSON.stringify({ id: existing.id, url: existing.url, client: existing.client,
      username: existing.username, password: "new", language: existing.language, environment: existing.environment }) })
  assert.equal(response.status, 200)
  assert.deepEqual(await profiles.get(existing.id), existing)
  assert.equal(await secrets.get(existing.id), "new")
  const production = await fetch(`${url.origin}/api/profile`, { method: "POST", headers,
    body: JSON.stringify({ id: existing.id, url: existing.url, client: existing.client,
      username: existing.username, password: "new", language: existing.language, environment: "production" }) })
  assert.equal(production.status, 200)
  const saved = await profiles.get(existing.id)
  assert.equal(saved.allowDataQueries, false)
  assert.equal(saved.classicBridgePath, existing.classicBridgePath)
})

async function temporaryDirectories(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sap-abap-mcp-onboard-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, "home")
  const cwd = join(root, "project")
  const config = join(root, "config")
  await Promise.all([mkdir(home), mkdir(cwd), mkdir(config)])
  return { root, home, cwd, config }
}

test("onboard diagnostics detect clients, settings files, and saved profiles", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  await mkdir(join(home, ".claude"))
  await writeFile(join(home, ".claude", "settings.json"), "{}\n")
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  await profiles.upsert({
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    username: "DEVELOPER"
  })
  await secrets.set("DEV100", "secret")

  const runner: CommandRunner = async (command, args) => {
    if (command === "npm") return result("10.9.0\n")
    if (command === "claude" && args[0] === "--version") return result("2.1.0\n")
    if (command === "claude") return result("sap-abap: npx.cmd ... - Connected\n")
    return result("", { ok: false, missing: true })
  }
  const status = await inspectOnboardStatus({
    profiles,
    secrets,
    runner,
    platform: "win32",
    homeDirectory: home,
    workingDirectory: cwd,
    async validateCredentials() {}
  })

  assert.equal(status.environment.credentialStorageSupported, true)
  assert.equal(status.environment.npm.version, "10.9.0")
  assert.deepEqual(status.clients.map(client => ({
    id: client.id,
    installed: client.installed,
    configured: client.configured
  })), [
    { id: "claude", installed: true, configured: true },
    { id: "codex", installed: false, configured: false }
  ])
  assert.equal(
    status.files.find(file => file.path === join(home, ".claude", "settings.json"))?.exists,
    true
  )
  assert.equal(
    status.files.find(file => file.path === join(cwd, ".claude"))?.exists,
    false
  )
  assert.deepEqual(status.profiles, [{
    id: "DEV100",
    url: "https://sap.example.test",
    client: "100",
    language: "EN",
    environment: "development",
    authType: "basic",
    username: "DEVELOPER",
    allowedPackages: [],
    credentialAvailable: true
  }])
})

test("onboarding distinguishes server registration from explicit MCP connection status", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  let listing = ""
  const options = { profiles: new ProfileStore(config), secrets: new MemorySecretStore(),
    homeDirectory: home, workingDirectory: cwd, async validateCredentials() {},
    runner: async (_command: string, args: readonly string[]) => result(args[0] === "mcp" ? listing : "1.0") }
  for (const [output, configured, connection] of [
    ["sap-abap: node index.js - ✓ Connected", true, "connected"],
    ["\u001b[31msap-abap: node missing.js - ✗ Failed to connect\u001b[0m", true, "failed"],
    ["sap-abap: remote - ⚠ Needs authentication", true, "authentication-required"],
    ["sap-abap  node  index.js serve  enabled  Unsupported", true, "unknown"],
    ["Warning: could not find sap-abap configuration", false, "unknown"],
    ["other-sap-abap: node index.js - Connected", false, "unknown"],
    ["sap-abap-test: node index.js - Connected", false, "unknown"]
  ] as const) {
    listing = output
    const status = await inspectOnboardStatus(options)
    assert.equal(status.clients[0]?.configured, configured, output)
    assert.equal(status.clients[0]?.mcpConnectionStatus, connection, output)
  }
})

test("onboard server keeps credentials local and configures Claude through its CLI", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  const commands: Array<{ command: string; args: readonly string[] }> = []
  let claudeConfigured = false
  const runner: CommandRunner = async (command, args) => {
    commands.push({ command, args })
    if (command === "npm") return result("10.9.0\n")
    if (command === "claude" && args[0] === "--version") return result("2.1.0\n")
    if (command === "claude" && args[0] === "mcp" && args[1] === "list") {
      return result(claudeConfigured ? "sap-abap: connected\n" : "No MCP servers configured\n")
    }
    if (command === "claude" && args[0] === "mcp" && args[1] === "add") {
      claudeConfigured = true
      return result("Added sap-abap\n")
    }
    return result("", { ok: false, missing: true })
  }
  let validated: { profile: SapProfile; password: string } | undefined
  const server = await startOnboardServer({
    profiles,
    secrets,
    runner,
    platform: "win32",
    homeDirectory: home,
    workingDirectory: cwd,
    async validateCredentials(profile, password) {
      validated = { profile, password }
    }
  })
  t.after(() => server.close())
  const pageUrl = new URL(server.url)
  const token = pageUrl.searchParams.get("token")
  assert.ok(token)

  const page = await fetch(server.url)
  assert.equal(page.status, 200)
  assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'nonce-/)
  assert.match(await page.text(), /SAP 개발 환경 시작하기/)
  assert.equal((await fetch(`${pageUrl.origin}/`)).status, 403)
  assert.equal((await fetch(`${pageUrl.origin}/api/status`)).status, 403)

  const headers = {
    "content-type": "application/json",
    "x-onboard-token": token
  }
  const profileResponse = await fetch(`${pageUrl.origin}/api/profile`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: "dev100",
      url: " https://sap.example.test/ ",
      client: "100",
      username: "DEVELOPER",
      password: "top-secret",
      language: "EN",
      environment: "development",
      allowedPackages: "Z_TEST, Z_SHARED"
    })
  })
  const profileText = await profileResponse.text()
  assert.equal(profileResponse.status, 200, profileText)
  assert.doesNotMatch(profileText, /top-secret/)
  assert.equal(validated?.profile.id, "DEV100")
  assert.equal(validated?.password, "top-secret")
  assert.equal(await secrets.get("DEV100"), "top-secret")

  const configureResponse = await fetch(`${pageUrl.origin}/api/client/configure`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clientId: "claude", profileId: "DEV100" })
  })
  assert.equal(configureResponse.status, 200, await configureResponse.text())
  const addCommand = commands.find(command =>
    command.command === "claude" && command.args[0] === "mcp" && command.args[1] === "add"
  )
  assert.deepEqual(addCommand?.args, [
    "mcp",
    "add",
    "--transport",
    "stdio",
    "--scope",
    "user",
    "--env",
    `SAP_ABAP_MCP_HOME=${config}`,
    "sap-abap",
    "--",
    process.execPath,
    fileURLToPath(new URL("../src/index.js", import.meta.url)),
    "serve",
    "--profile",
    "DEV100",
    "--preset",
    "minimal"
  ])

  const launch = addCommand!.args.slice(addCommand!.args.indexOf("--") + 1)
  const profileEnvironment = addCommand!.args[addCommand!.args.indexOf("--env") + 1]!
  const client = new Client({ name: "onboard-launch-test", version: "1" })
  const transport = new StdioClientTransport({ command: launch[0]!, args: launch.slice(1), cwd,
    env: { ...getDefaultEnvironment(), SAP_ABAP_MCP_HOME: profileEnvironment.slice("SAP_ABAP_MCP_HOME=".length) }, stderr: "pipe" })
  try {
    await client.connect(transport)
    assert.equal((await client.listTools()).tools.length, 5)
  } finally { await client.close(); await transport.close() }

  const finishResponse = await fetch(`${pageUrl.origin}/api/finish`, {
    method: "POST",
    headers,
    body: "{}"
  })
  assert.equal(finishResponse.status, 200)
  await server.finished
})

test("failed SAP verification preserves the existing profile and credential", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  const existing = await profiles.upsert({
    id: "DEV100",
    url: "https://old.example.test",
    client: "100",
    username: "OLD_USER"
  })
  await secrets.set("DEV100", "old-secret")
  const runner: CommandRunner = async () => result("", { ok: false, missing: true })
  let validationCalls = 0
  const server = await startOnboardServer({
    profiles,
    secrets,
    runner,
    platform: "win32",
    homeDirectory: home,
    workingDirectory: cwd,
    async validateCredentials() {
      validationCalls += 1
      throw new AppError("LOGIN_FAILED", "SAP login failed")
    }
  })
  t.after(() => server.close())
  const pageUrl = new URL(server.url)
  const token = pageUrl.searchParams.get("token") ?? ""
  const response = await fetch(`${pageUrl.origin}/api/profile`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-onboard-token": token },
    body: JSON.stringify({
      id: "DEV100",
      url: "https://new.example.test",
      client: "200",
      username: "NEW_USER",
      password: "wrong-secret",
      language: "EN",
      environment: "quality",
      allowedPackages: ""
    })
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await profiles.get("DEV100"), existing)
  assert.equal(await secrets.get("DEV100"), "old-secret")
  assert.equal(validationCalls, 1)

  const oauthProfile = await profiles.upsert({
    id: "BTP100",
    url: "https://btp.example.test",
    client: "100",
    authType: "oauth_client_credentials",
    tokenUrl: "https://auth.example.test/oauth/token",
    clientId: "mcp-client"
  })
  await secrets.set("BTP100", "client-secret")
  const oauthResponse = await fetch(`${pageUrl.origin}/api/profile`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-onboard-token": token },
    body: JSON.stringify({
      id: "BTP100",
      url: "https://replacement.example.test",
      client: "100",
      username: "BASIC_USER",
      password: "basic-secret",
      language: "EN",
      environment: "development",
      allowedPackages: ""
    })
  })
  assert.equal(oauthResponse.status, 400)
  assert.equal((await oauthResponse.json()).code, "PROFILE_AUTH_TYPE_UNSUPPORTED")
  assert.deepEqual(await profiles.get("BTP100"), oauthProfile)
  assert.equal(await secrets.get("BTP100"), "client-secret")
  assert.equal(validationCalls, 1)
})


test("onboarding refuses registration when existing settings cannot be read and resumes after recovery", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", username: "DEV", language: "EN", environment: "development" })
  let readable = false
  let registered = false
  let writes = 0
  const runner: CommandRunner = async (command, args) => {
    if (args[0] === "--version") return result("1.0")
    if (args[1] === "list") return readable ? result(registered ? "sap-abap: connected" : "No MCP servers")
      : result("", { ok: false, stderr: "Could not parse existing settings" })
    if (args[1] === "add") {
      assert.equal(command, "codex")
      assert.deepEqual(args, ["mcp", "add", "--env", `SAP_ABAP_MCP_HOME=${config}`, "sap-abap", "--",
        process.execPath, fileURLToPath(new URL("../src/index.js", import.meta.url)), "serve", "--profile", "DEV100", "--preset", "minimal"])
      writes++; registered = true; return result("added")
    }
    return result("1.0")
  }
  const options = { profiles, secrets: new MemorySecretStore(), runner, homeDirectory: home, workingDirectory: cwd, async validateCredentials() {} }
  const status = await inspectOnboardStatus(options)
  assert.equal(status.clients[0]?.issue, "Could not parse existing settings")
  assert.equal(status.clients[0]?.configured, false)
  const server = await startOnboardServer(options)
  t.after(() => server.close())
  const url = new URL(server.url)
  const configure = () => fetch(`${url.origin}/api/client/configure`, { method: "POST",
    headers: { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! },
    body: JSON.stringify({ clientId: "codex", profileId: "DEV100" }) })
  const failed = await configure()
  assert.notEqual(failed.status, 200)
  assert.match(await failed.text(), /CLIENT_CONFIG_UNREADABLE/)
  assert.equal(writes, 0)
  readable = true
  assert.equal((await configure()).status, 200)
  assert.equal(writes, 1)
  assert.equal((await configure()).status, 200)
  assert.equal(writes, 1)
})

test("onboarding launches each selected discovery mode and rejects unknown modes before registration", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  await profiles.upsert({ id: "MODE100", url: "https://sap.example.test", client: "100", username: "TEST" })
  let registered = false
  const registrations: Array<readonly string[]> = []
  const runner: CommandRunner = async (_command, args) => {
    if (args[1] === "list") return result(registered ? "sap-abap: connected" : "No MCP servers")
    if (args[1] === "add") { registrations.push(args); registered = true }
    return result("1.0")
  }
  const server = await startOnboardServer({ profiles, secrets: new MemorySecretStore(), runner,
    homeDirectory: home, workingDirectory: cwd, async validateCredentials() {} })
  t.after(() => server.close())
  const url = new URL(server.url)
  const configure = (preset: string) => fetch(`${url.origin}/api/client/configure`, { method: "POST",
    headers: { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! },
    body: JSON.stringify({ clientId: "codex", profileId: "MODE100", preset }) })
  assert.equal((await configure("all")).status, 400)
  assert.equal(registrations.length, 0)
  for (const [preset, count] of [["adaptive", 17], ["minimal", 5], ["single", 1]] as const) {
    registered = false
    assert.equal((await configure(preset)).status, 200)
    const args = registrations.at(-1)!
    const launch = args.slice(args.indexOf("--") + 1)
    assert.deepEqual(launch.slice(-2), ["--preset", preset])
    const client = new Client({ name: "onboard-mode-test", version: "1" })
    const transport = new StdioClientTransport({ command: launch[0]!, args: launch.slice(1), cwd,
      env: { ...getDefaultEnvironment(), SAP_ABAP_MCP_HOME: config }, stderr: "pipe" })
    try {
      await client.connect(transport)
      const tools = (await client.listTools()).tools
      assert.equal(tools.length, count)
      if (preset === "single") assert.deepEqual(tools.map(tool => tool.name), ["sap"])
    } finally { await client.close(); await transport.close() }
    const writes: number = registrations.length
    assert.equal((await configure("single")).status, 200)
    assert.equal(registrations.length, writes, "Existing registrations retain their mode")
  }
})
