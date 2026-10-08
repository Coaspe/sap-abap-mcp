import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { Script } from "node:vm"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { AppError } from "../src/errors.js"
import { adtException } from "abap-adt-api"
import {
  inspectOnboardStatus,
  startOnboardServer,
  type CommandResult,
  type CommandRunner
} from "../src/onboard.js"
import { ProfileStore, type SapProfile } from "../src/profile-store.js"
import { MemorySecretStore } from "../src/secret-store.js"
import { onboardPage } from "../src/onboard-page.js"

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

test("onboarding normalizes SAP authentication failures and redacts diagnostics before returning them", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  const existing = await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", username: "USER" })
  await secrets.set(existing.id, "saved-secret")
  let status = 401
  const server = await startOnboardServer({ profiles, secrets, platform: "darwin",
    homeDirectory: home, workingDirectory: cwd, runner: async () => result(),
    async validateCredentials() { throw adtException("Authorization: Bearer private-token password=body-secret", status) }
  })
  t.after(() => server.close())
  const url = new URL(server.url)
  const headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
  for (const [httpStatus, code] of [[401, "AUTH_REQUIRED"], [403, "SAP_AUTHORIZATION_DENIED"]] as const) {
    status = httpStatus
    const response = await fetch(`${url.origin}/api/profile/verify`, { method: "POST", headers,
      body: JSON.stringify({ profileId: existing.id }) })
    assert.equal(response.status, 400)
    const body = await response.json() as { code: string; message: string }
    assert.equal(body.code, code)
    assert.equal(JSON.stringify(body).includes("private-token"), false)
    assert.equal(JSON.stringify(body).includes("body-secret"), false)
  }
  assert.deepEqual(await profiles.get(existing.id), existing)
  assert.equal(await secrets.get(existing.id), "saved-secret")
})

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
    readOnly: false,
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
    ["sap-abap: node index.js - ✔ Connected", true, "connected"],
    ["sap-abap: node missing.js - ✘ Failed to connect", true, "failed"],
    ["sap-abap: node missing.js - ✘ Failed to connect: ENOENT", true, "failed"],
    ["sap-abap: remote - ! Needs authentication (HTTP 401)", true, "authentication-required"],
    ["sap-abap: remote - ! Needs authentication", true, "authentication-required"],
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

test("onboarding compares the selected profile's registration without replacing existing settings", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  await profiles.upsert({ id: "DEV100", url: "https://sap.example.test", client: "100", readOnly: true })
  const serverFile = fileURLToPath(new URL("../src/index.js", import.meta.url))
  let scenario = "matching", writes = 0
  const runner: CommandRunner = async (command, args) => {
    if (args[0] === "--version") return result("fixture 1")
    if (args[1] === "list") return result("sap-abap: node server.js - ✔ Connected")
    if (args[1] === "add") { writes++; return result("added") }
    if (args[1] !== "get") return result()
    if (scenario === "unreadable") return result("secret-get-output", { ok: false, stderr: "secret-get-error" })
    if (scenario === "malformed") return result("secret-malformed-config")
    const commandPath = scenario === "runtime" ? "/old/node" : process.execPath
    const launch = [scenario === "server-runtime" ? "/old/server.js" : serverFile, "serve",
      ...(scenario === "all-profiles" ? [] : scenario === "equals-profile" ? ["--profile=QA100"] : scenario === "equals-matching" ? ["--profile=DEV100"] : ["--profile", scenario === "profile" ? "QA100" : "DEV100"]),
      "--preset", "adaptive", ...(scenario === "legacy-api" ? ["--api-version=v0"] : scenario === "repeated-api" ? ["--api-version=v1", "--api-version=v0"] : scenario === "equals-matching" ? ["--api-version=v1"] : scenario === "http-mode" ? ["--http"] : [])]
    const profileHome = scenario === "profile-home" ? "/other/sap-profiles" : scenario === "missing-home" ? undefined : scenario === "variable-home" ? "${SAP_PROFILE_HOME}" : config
    if (command === "codex") return result(JSON.stringify({ enabled: scenario !== "disabled", transport: {
      type: "stdio", command: commandPath, args: launch,
      env: { ...(profileHome ? { SAP_ABAP_MCP_HOME: profileHome } : {}), PRIVATE_TOKEN: "secret-env-value" }
    } }))
    return result(`sap-abap:\n  Type: stdio\n  Status: ${scenario === "disabled" ? "⊘ Disabled for this project" : "✔ Connected"}\n  Command: ${commandPath}\n  Args: ${launch.join(" ")}\n  Environment:\n${profileHome ? `    SAP_ABAP_MCP_HOME=${profileHome}\n` : ""}    PRIVATE_TOKEN=secret-env-value\n`)
  }
  const server = await startOnboardServer({ profiles, secrets: new MemorySecretStore(), runner,
    homeDirectory: home, workingDirectory: cwd, async validateCredentials() {} })
  t.after(() => server.close())
  const url = new URL(server.url), headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
  for (const [value, state, difference] of [
    ["matching", "matches", undefined], ["all-profiles", "matches", undefined],
    ["runtime", "different", "runtime"], ["profile", "different", "profile"],
    ["server-runtime", "different", "runtime"], ["equals-profile", "different", "profile"],
    ["equals-matching", "matches", undefined], ["legacy-api", "different", "runtime"], ["http-mode", "different", "runtime"],
    ["repeated-api", "different", "runtime"],
    ["profile-home", "different", "profile-home"], ["disabled", "different", "disabled"],
    ["missing-home", "unknown", undefined], ["variable-home", "unknown", undefined], ["unreadable", "unknown", undefined], ["malformed", "unknown", undefined]
  ] as const) {
    scenario = value
    const response = await fetch(`${url.origin}/api/status?profileId=dev100`, { headers })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.doesNotMatch(text, /secret-(?:env|get|malformed)/)
    const status = JSON.parse(text)
    for (const client of status.clients) {
      assert.equal(client.registration.state, state, `${client.id}: ${value}`)
      assert.deepEqual(client.registration.differences, difference ? [difference] : [])
      assert.equal(client.registration.expected.profileId, "DEV100")
      const configured = await fetch(`${url.origin}/api/client/configure`, { method: "POST", headers,
        body: JSON.stringify({ clientId: client.id, profileId: "dev100" }) })
      assert.equal(configured.status, 200)
      assert.equal((await configured.json() as any).client.registration.state, state)
    }
  }
  assert.equal(writes, 0, "Existing registrations are never replaced")
  assert.equal((await fetch(`${url.origin}/api/status?profileId=invalid%20id`, { headers })).status, 400)
  assert.equal((await fetch(`${url.origin}/api/status?profileId=MISSING`, { headers })).status, 404)
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
    "sap-abap",
    "--env",
    `SAP_ABAP_MCP_HOME=${config}`,
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

async function advancedOnboard(t: test.TestContext, overrides: {
  validateCredentials?: (profile: SapProfile, credential: string) => Promise<void | string>
  browserLogin?: typeof import("../src/oauth-authorization-code.js").browserOAuthLogin
} = {}) {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  const verified: Array<{ profile: SapProfile; credential: string }> = []
  const server = await startOnboardServer({ profiles, secrets, platform: "darwin",
    homeDirectory: home, workingDirectory: cwd, runner: async () => result(),
    async validateCredentials(profile, credential) { verified.push({ profile, credential }) }, ...overrides })
  t.after(() => server.close())
  const url = new URL(server.url)
  const headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
  const post = (path: string, body: unknown) => fetch(`${url.origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) })
  return { profiles, secrets, verified, post, url, headers }
}

const oauthSetup = { id: "OAUTH100", url: "https://sap.example.test", client: "100", language: "EN",
  environment: "development", tokenUrl: "https://login.example.test/oauth/token", clientId: "desktop-client", scope: "sap" }
const serviceKey = JSON.stringify({ url: "https://abap.example.test", uaa: {
  url: "https://login.example.test", clientid: "service-client", clientsecret: "private-service-secret" } })

test("onboarding imports a BTP service key, validates its derived settings and never returns the key", async t => {
  const f = await advancedOnboard(t)
  const response = await f.post("/api/profile", { id: "BTP100", authType: "btp_service_key", serviceKey,
    language: "EN", environment: "production", allowedPackages: "Z_SAFE" })
  assert.equal(response.status, 200)
  assert.doesNotMatch(await response.text(), /private-service-secret|uaa|serviceKey/)
  assert.equal(f.verified[0]?.credential, "private-service-secret")
  const profile = await f.profiles.get("BTP100")
  assert.equal(profile.authType, "oauth_client_credentials")
  assert.equal(profile.url, "https://abap.example.test")
  assert.equal(profile.client, "100")
  assert.equal(profile.allowDataQueries, false)
  assert.deepEqual(profile.allowedPackages, ["Z_SAFE"])
  assert.equal(await f.secrets.get(profile.id), "private-service-secret")
  assert.doesNotMatch(await (await fetch(`${f.url.origin}/api/status`, { headers: f.headers })).text(), /private-service-secret|uaa/)
})

test("onboarding renews OAuth client credentials while preserving stored policy and bridge settings", async t => {
  const f = await advancedOnboard(t)
  const original = await f.profiles.upsert({ ...oauthSetup, environment: "development", authType: "oauth_client_credentials",
    allowedPackages: ["Z_LOCKED"], allowDataQueries: true, classicBridgePath: "/sap/bc/zbridge" })
  const response = await f.post("/api/profile", { ...oauthSetup, authType: "oauth_client_credentials", clientSecret: "private-new-secret" })
  assert.equal(response.status, 200)
  assert.doesNotMatch(await response.text(), /private-new-secret/)
  assert.deepEqual(await f.profiles.get(original.id), original)
  assert.equal(await f.secrets.get(original.id), "private-new-secret")
  const status = await (await fetch(`${f.url.origin}/api/status`, { headers: f.headers })).json() as any
  assert.equal(status.profiles[0].tokenUrl, oauthSetup.tokenUrl)
  assert.equal(status.profiles[0].clientId, oauthSetup.clientId)
})

test("onboarding browser OAuth validates the encoded credential before protected persistence", async t => {
  const encoded = JSON.stringify({ version: 1, accessToken: "private-access", refreshToken: "private-refresh", expiresAt: 9999999999999 })
  const f = await advancedOnboard(t, { async browserLogin(config, options) {
    assert.equal(config.authorizationUrl, "https://login.example.test/oauth/authorize")
    assert.equal(config.clientId, oauthSetup.clientId)
    assert.ok(options?.signal)
    return encoded
  } })
  const response = await f.post("/api/profile", { ...oauthSetup, authType: "oauth_authorization_code",
    authorizationUrl: "https://login.example.test/oauth/authorize" })
  assert.equal(response.status, 200)
  assert.equal(f.verified[0]?.credential, encoded)
  assert.equal(await f.secrets.get(oauthSetup.id), encoded)
  assert.doesNotMatch(await response.text(), /private-access|private-refresh/)
})

test("onboarding rejects malformed service keys and irrelevant auth fields before validation", async t => {
  const f = await advancedOnboard(t)
  const invalid = [
    { id: "BTP100", language: "EN", environment: "development", authType: "btp_service_key", serviceKey: "{ private-secret" },
    { ...oauthSetup, authType: "oauth_client_credentials", clientSecret: "private-secret", password: "irrelevant" },
    { ...oauthSetup, authType: "oauth_client_credentials", clientSecret: "private-secret", tokenUrl: "http://unsafe.example.test" }
  ]
  for (const body of invalid) {
    const response = await f.post("/api/profile", body)
    assert.equal(response.status, 400)
    assert.doesNotMatch(await response.text(), /private-secret/)
  }
  assert.equal(f.verified.length, 0)
  assert.deepEqual(await f.profiles.list(), [])
})

test("onboarding failed OAuth renewal leaves the profile and protected secret unchanged", async t => {
  const f = await advancedOnboard(t, { async validateCredentials() { throw adtException("client_secret=private-failed", 401) } })
  const original = await f.profiles.upsert({ ...oauthSetup, environment: "development", authType: "oauth_client_credentials" })
  await f.secrets.set(original.id, "old-secret")
  const response = await f.post("/api/profile", { ...oauthSetup, authType: "oauth_client_credentials", clientSecret: "private-failed" })
  assert.equal(response.status, 400)
  assert.doesNotMatch(await response.text(), /private-failed/)
  assert.deepEqual(await f.profiles.get(original.id), original)
  assert.equal(await f.secrets.get(original.id), "old-secret")
})

test("onboarding cancellation interrupts browser login, preserves state and allows a fresh attempt", async t => {
  let started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  let attempts = 0
  const f = await advancedOnboard(t, { async browserLogin(_config, options) {
    if (++attempts > 1) return "encoded-credential"
    started()
    return new Promise((_resolve, reject) => options!.signal!.addEventListener("abort", () => {
      reject(new AppError("CANCELLED", "Browser OAuth login was cancelled"))
    }, { once: true }))
  } })
  const body = { ...oauthSetup, authType: "oauth_authorization_code", authorizationUrl: "https://login.example.test/oauth/authorize" }
  const pending = f.post("/api/profile", body)
  await waiting
  assert.equal((await f.post("/api/profile/cancel", {})).status, 200)
  const response = await pending
  assert.equal((await response.json()).code, "CANCELLED")
  assert.deepEqual(await f.profiles.list(), [])
  assert.equal(await f.secrets.get(oauthSetup.id), undefined)
  assert.equal((await f.post("/api/profile", body)).status, 200)
})

test("onboarding cancellation during SAP verification prevents persistence after verification returns", async t => {
  let started!: () => void
  let resume!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve })
  const blocked = new Promise<void>(resolve => { resume = resolve })
  const f = await advancedOnboard(t, { async validateCredentials() { started(); await blocked } })
  const pending = f.post("/api/profile", { ...oauthSetup, authType: "oauth_client_credentials", clientSecret: "cancelled-secret" })
  await waiting
  await f.post("/api/profile/cancel", {})
  resume()
  assert.equal((await (await pending).json()).code, "CANCELLED")
  assert.deepEqual(await f.profiles.list(), [])
  assert.equal(await f.secrets.get(oauthSetup.id), undefined)
})


test("onboarding stores the refreshed credential returned by successful validation", async t => {
  const f = await advancedOnboard(t, { async validateCredentials() { return "validated-rotated-credential" },
    async browserLogin() { return "initial-credential" } })
  const response = await f.post("/api/profile", { ...oauthSetup, authType: "oauth_authorization_code",
    authorizationUrl: "https://login.example.test/oauth/authorize" })
  // Avoid any real browser or IdP during this persistence check.
  assert.equal(response.status, 200)
  assert.equal(await f.secrets.get(oauthSetup.id), "validated-rotated-credential")
})

test("onboarding selects the browser language and explicit locale without weakening URL authentication", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const server = await startOnboardServer({ profiles: new ProfileStore(config), secrets: new MemorySecretStore(),
    platform: "darwin", homeDirectory: home, workingDirectory: cwd, runner: async () => result(),
    async validateCredentials() { throw new Error("Page language must not authenticate SAP") } })
  t.after(() => server.close())
  for (const [language, requested, expected] of [
    [undefined, undefined, "ko"], ["ko-KR,ko;q=0.9,en;q=0.8", undefined, "ko"],
    ["en-US,en;q=0.9", undefined, "en"], ["de-DE,de;q=0.9", undefined, "en"],
    ["en-US", "ko", "ko"], ["ko-KR", "en", "en"], ["en-US", "<script>alert(1)</script>", "en"]
  ] as const) {
    const url = new URL(server.url)
    if (requested) url.searchParams.set("lang", requested)
    const response = await fetch(url, language ? { headers: { "accept-language": language } } : {})
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.ok(html.includes(`<html lang="${expected}">`))
    assert.ok(html.includes(expected === "en" ? "Verify connection and save" : "연결 확인 후 저장"))
    assert.ok(response.headers.get("content-security-policy")?.includes("script-src 'nonce-"))
    assert.doesNotMatch(html, /alert\(1\)/)
    new Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!)
  }
  const unauthenticated = new URL(server.url)
  unauthenticated.searchParams.delete("token")
  unauthenticated.searchParams.set("lang", "en")
  assert.equal((await fetch(unauthenticated)).status, 403)
})

test("English onboarding localizes recovery and first query while escaping script tokens", () => {
  const html = onboardPage('</script><script>alert("secret")</script>', "fixture-nonce", "en")
  assert.ok(html.includes("Save tokens — 5 tools (default)"))
  assert.ok(html.includes("Complete the sign-in window and try again."))
  assert.ok(html.includes("Show an actual system query result"))
  assert.ok(html.includes('name="language"'))
  assert.ok(html.includes('value="EN" selected'))
  assert.doesNotMatch(html.replace(">한국어</a>", ">Korean</a>"), /[\uac00-\ud7a3]/)
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!
  assert.doesNotMatch(script, /[\uac00-\ud7a3]/)
  assert.doesNotMatch(script, /<\/script>/)
  new Script(script)
})

test("new browser profiles start read-only and require an explicit package scope to enable writes", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  let validations = 0
  const server = await startOnboardServer({ profiles, secrets: new MemorySecretStore(), platform: "darwin",
    homeDirectory: home, workingDirectory: cwd, runner: async () => result(),
    async validateCredentials() { validations++ } })
  t.after(() => server.close())
  const url = new URL(server.url)
  const headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
  const input = { id: "DEV100", url: "https://sap.example.test", client: "100", language: "EN",
    environment: "development", username: "USER", password: "fixture" }
  const save = async (changes: Record<string, unknown> = {}) => fetch(`${url.origin}/api/profile`, {
    method: "POST", headers, body: JSON.stringify({ ...input, ...changes }) })
  assert.equal((await save()).status, 200)
  assert.equal((await profiles.get("DEV100") as any).readOnly, true)
  const status = await (await fetch(`${url.origin}/api/status`, { headers })).json() as any
  assert.equal(status.profiles[0].readOnly, true)
  assert.equal((await save()).status, 200)
  assert.equal((await profiles.get("DEV100") as any).readOnly, true)
  const previousValidations = validations
  const refused = await save({ accessMode: "packages", allowedPackages: " , " })
  assert.equal(refused.status, 400)
  assert.equal((await refused.json() as any).code, "PROFILE_WRITE_POLICY_INVALID")
  assert.equal(validations, previousValidations)
  assert.equal((await profiles.get("DEV100") as any).readOnly, true)
  assert.equal((await save({ accessMode: "packages", allowedPackages: "z_safe, Z_SHARED" })).status, 200)
  assert.equal((await profiles.get("DEV100") as any).readOnly, false)
  assert.deepEqual((await profiles.get("DEV100")).allowedPackages, ["Z_SAFE", "Z_SHARED"])
  assert.equal((await save({ accessMode: "read_only" })).status, 200)
  assert.equal((await profiles.get("DEV100") as any).readOnly, true)
  assert.deepEqual((await profiles.get("DEV100")).allowedPackages, ["Z_SAFE", "Z_SHARED"])
  const production = await save({ environment: "production", accessMode: "unrestricted" })
  assert.equal(production.status, 400)
  assert.equal((await production.json() as any).code, "PROFILE_WRITE_POLICY_INVALID")
  assert.equal((await save({ accessMode: "unrestricted" })).status, 200)
  assert.equal((await profiles.get("DEV100") as any).readOnly, false)
  assert.deepEqual((await profiles.get("DEV100")).allowedPackages, [])
})


test("app-managed onboarding skips CLIs and requires a verified selected SAP profile", async t => {
  const { home, cwd, config } = await temporaryDirectories(t)
  const profiles = new ProfileStore(config)
  const secrets = new MemorySecretStore()
  let verificationFails = false
  const server = await startOnboardServer({ profiles, secrets, hostManaged: true, platform: "darwin",
    homeDirectory: home, workingDirectory: cwd,
    runner: async () => { throw new Error("App-managed setup must not query or configure a CLI") },
    async validateCredentials() { if (verificationFails) throw new AppError("AUTH_FAILED", "Rejected") } })
  t.after(() => server.close())
  const url = new URL(server.url)
  const headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
  const post = (path: string, body: unknown) => fetch(`${url.origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) })
  const status = await (await fetch(`${url.origin}/api/status`, { headers })).json() as any
  assert.equal(status.hostManaged, true)
  assert.deepEqual(status.clients, [])
  assert.equal(status.environment.npm.installed, false)
  assert.deepEqual(status.files, [])
  assert.equal((await post("/api/finish", { profileId: "DEV100" })).status, 409)
  assert.equal((await post("/api/client/configure", { clientId: "codex", profileId: "DEV100" })).status, 409)
  const saved = await post("/api/profile", { id: "DEV100", url: "https://sap.example.test", client: "100",
    username: "DEVELOPER", password: "fixture", language: "EN", environment: "development" })
  assert.equal(saved.status, 200)
  assert.equal((await profiles.get("DEV100")).readOnly, true)
  assert.equal((await post("/api/finish", { profileId: "OTHER100" })).status, 409)
  verificationFails = true
  assert.equal((await post("/api/profile/verify", { profileId: "DEV100" })).status, 400)
  assert.equal((await post("/api/finish", { profileId: "DEV100" })).status, 409)
  verificationFails = false
  assert.equal((await post("/api/profile/verify", { profileId: "dev100" })).status, 200)
  assert.equal((await post("/api/finish", { profileId: "dev100" })).status, 200)
  await server.finished
})

test("app-managed onboarding localizes its no-CLI path without leaking script tokens", () => {
  for (const locale of ["ko", "en"] as const) {
    const html = onboardPage('</script><script>alert("secret")</script>', "fixture", locale, true)
    assert.ok(html.includes('id="tool-preset-help" hidden'))
    assert.ok(html.includes('const HOST_MANAGED = true;'))
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!
    if (locale === "en") assert.doesNotMatch(script, /[\uac00-\ud7a3]/)
    assert.doesNotMatch(script, /<\/script>/)
    new Script(script)
  }
})

for (const authType of ["basic", "oauth_client_credentials", "oauth_authorization_code"] as const) {
  test(`app-managed setup renews ${authType} only after validation and preserves access scope`, async t => {
    const { config } = await temporaryDirectories(t)
    const profiles = new ProfileStore(config)
    const secrets = new MemorySecretStore()
    const auth = authType === "basic" ? { username: "DEVELOPER" } : {
      tokenUrl: "https://login.example.test/oauth/token", clientId: "desktop-client",
      ...(authType === "oauth_authorization_code" ? { authorizationUrl: "https://login.example.test/oauth/authorize" } : {})
    }
    const original = await profiles.upsert({ id: "RENEW100", url: "https://sap.example.test", client: "100",
      language: "EN", environment: "development", authType, ...auth,
      readOnly: true, allowedPackages: ["Z_LOCKED"], classicBridgePath: "/sap/bc/zbridge", allowDataQueries: false })
    await secrets.set(original.id, "old-credential")
    let expired = true
    const disconnected: string[] = []
    const renewed = authType === "oauth_authorization_code"
      ? JSON.stringify({ version: 1, accessToken: "new-access", refreshToken: "new-refresh", expiresAt: 9999999999999 })
      : "new-credential"
    const server = await startOnboardServer({ profiles, secrets, hostManaged: true, platform: "darwin",
      runner: async () => { throw new Error("Renewal must not call or configure a CLI") },
      disconnectProfile: async id => {
        assert.equal(await secrets.get(id), renewed, "Invalidate only after protected persistence succeeds")
        disconnected.push(id)
      },
      async browserLogin() { return renewed },
      async validateCredentials(_profile, credential) {
        if (expired) throw new AppError("AUTH_REQUIRED", "Expired")
        assert.equal(credential, renewed)
      } })
    t.after(() => server.close())
    const url = new URL(server.url)
    const headers = { "content-type": "application/json", "x-onboard-token": url.searchParams.get("token")! }
    const post = (path: string, body: unknown) => fetch(`${url.origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) })
    const body = { id: original.id, url: original.url, client: original.client, language: original.language,
      environment: original.environment, authType, ...auth,
      ...(authType === "basic" ? { password: renewed } : authType === "oauth_client_credentials" ? { clientSecret: renewed } : {}) }
    assert.equal((await post("/api/profile/verify", { profileId: original.id })).status, 400)
    assert.equal((await post("/api/profile", body)).status, 400)
    assert.equal((await post("/api/finish", { profileId: original.id })).status, 409)
    assert.deepEqual(await profiles.get(original.id), original)
    assert.equal(await secrets.get(original.id), "old-credential")
    assert.deepEqual(disconnected, [])
    expired = false
    const saved = await post("/api/profile", body)
    assert.equal(saved.status, 200)
    assert.doesNotMatch(await saved.text(), /new-credential|new-access|new-refresh/)
    assert.deepEqual(await profiles.get(original.id), original)
    assert.equal(await secrets.get(original.id), renewed)
    assert.deepEqual(disconnected, [original.id])
    assert.equal((await post("/api/client/configure", { clientId: "claude", profileId: original.id })).status, 409)
    assert.equal((await post("/api/finish", { profileId: original.id })).status, 200)
    await server.finished
  })
}
