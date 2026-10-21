import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import test from "node:test"
import { FILE_HOSTS, fileHostConfigPath, inspectFileHost, planFileHostRegistration, applyFileHostRegistration } from "../src/host-config.js"
import { readRegistration, planRegistrationRepair, checkFileHostScope } from "../src/registration.js"
import { ProfileStore } from "../src/profile-store.js"
import { packageLaunch } from "../src/launch-contract.js"

const run = promisify(execFile)
test("four host formats preserve settings and backups, reject duplicates and support repair", async t => {
  const root = await mkdtemp(join(tmpdir(), "sap-host-")); t.after(() => rm(root, { recursive: true, force: true }))
  const environment = { homeDirectory: root, platform: "darwin" as const }
  const profileHome = join(root, "profiles")
  for (const host of FILE_HOSTS) {
    const path = fileHostConfigPath(host.id, environment)
    assert.equal((await inspectFileHost(host.id, environment)).installed, false)
    await mkdir(dirname(path), { recursive: true })
    const original = { preferences: { theme: "dark" }, [host.serversKey]: { other: { command: "other", env: { SECRET: "keep" } } } }
    const before = JSON.stringify(original)
    await writeFile(path, before)
    assert.equal((await inspectFileHost(host.id, environment)).installed, true)
    const plan = await planFileHostRegistration(host.id, packageLaunch("darwin", "2.0.1", ["serve", "--profile", "DEV"]), { SAP_ABAP_MCP_HOME: profileHome }, environment)
    assert.equal(await readFile(path, "utf8"), before, "Preview does not write")
    const entry = JSON.parse(plan.text)[host.serversKey]["sap-abap"]
    assert.equal(entry.type, host.stdioType ? "stdio" : undefined)
    const applied = await applyFileHostRegistration(plan)
    assert.equal(await readFile(applied.backup!, "utf8"), before)
    const document = JSON.parse(await readFile(path, "utf8"))
    assert.deepEqual(document.preferences, original.preferences)
    assert.deepEqual(document[host.serversKey].other, original[host.serversKey]!.other)
    await assert.rejects(planFileHostRegistration(host.id, packageLaunch(), {}, environment), /already registered/)
    const file = await readRegistration(host.id, path)
    const repair = planRegistrationRepair(file, host.id, "DEV", profileHome, "2.1.0")
    const repaired = JSON.parse(repair.text)
    assert.equal(repaired[host.serversKey]["sap-abap"].args[1], "@coaspe/sap-abap-mcp@2.1.0")
    assert.deepEqual(repaired.preferences, original.preferences)
    assert.deepEqual(repaired[host.serversKey].other, original[host.serversKey]!.other)
  }
})

test("host paths honor isolated home and platform without reading real APPDATA", () => {
  const saved = process.env.APPDATA; process.env.APPDATA = "/actual-user-data"
  try {
    const env = { homeDirectory: "/isolated", platform: "win32" as const }
    assert.equal(fileHostConfigPath("vscode", env), join("/isolated", "AppData", "Roaming", "Code", "User", "mcp.json"))
    assert.equal(fileHostConfigPath("claude-desktop", env), join("/isolated", "AppData", "Roaming", "Claude", "claude_desktop_config.json"))
    assert.equal(fileHostConfigPath("cursor", env), join("/isolated", ".cursor", "mcp.json"))
    assert.equal(fileHostConfigPath("gemini", env), join("/isolated", ".gemini", "settings.json"))
    assert.equal(fileHostConfigPath("vscode", { homeDirectory: "/isolated", platform: "linux" }), join("/isolated", ".config", "Code", "User", "mcp.json"))
    assert.throws(() => fileHostConfigPath("claude-desktop", { platform: "linux" }), /supported on Windows/)
  } finally { if (saved === undefined) delete process.env.APPDATA; else process.env.APPDATA = saved }
})

test("registration refuses invalid JSON, workspace overrides and changes since preview", async t => {
  const root = await mkdtemp(join(tmpdir(), "sap-host-guards-")); t.after(() => rm(root, { recursive: true, force: true }))
  const env = { homeDirectory: root }
  const path = fileHostConfigPath("cursor", env)
  await mkdir(dirname(path), { recursive: true })
  for (const invalid of ["{ // comment\n}", "[]", '{"mcpServers": []}']) {
    await writeFile(path, invalid)
    assert.ok((await inspectFileHost("cursor", env)).issue)
    await assert.rejects(planFileHostRegistration("cursor", packageLaunch(), {}, env), /JSON object/)
    assert.equal(await readFile(path, "utf8"), invalid)
  }
  await writeFile(path, "{}")
  const plan = await planFileHostRegistration("cursor", packageLaunch(), {}, env)
  await writeFile(path, '{"changed":true}')
  await assert.rejects(applyFileHostRegistration(plan), /changed after preview/)
  assert.equal(await readFile(path, "utf8"), '{"changed":true}')
  const cwd = join(root, "project")
  await mkdir(join(cwd, ".vscode"), { recursive: true })
  await writeFile(join(cwd, ".vscode", "mcp.json"), '{"servers":{"sap-abap":{"command":"custom"}}}')
  await assert.rejects(checkFileHostScope("vscode", cwd), /workspace sap-abap/i)
})

test("register CLI previews by default and only writes an explicitly applied file", async t => {
  const root = await mkdtemp(join(tmpdir(), "sap-register-cli-")); t.after(() => rm(root, { recursive: true, force: true }))
  const profiles = new ProfileStore(join(root, "profiles"))
  await profiles.upsert({ id: "DEV", url: "https://sap.example.test", client: "100" })
  const path = join(root, "settings.json")
  await writeFile(path, '{"theme":"keep"}')
  const args = ["dist/src/index.js", "register", "DEV", "--client", "gemini", "--config", path]
  const options = { env: { ...process.env, SAP_ABAP_MCP_HOME: dirname(profiles.filePath) } }
  const preview = JSON.parse((await run(process.execPath, args, options)).stdout)
  assert.equal(preview.applied, false)
  assert.equal(await readFile(path, "utf8"), '{"theme":"keep"}')
  const applied = JSON.parse((await run(process.execPath, [...args, "--apply"], options)).stdout)
  assert.equal(applied.applied, true)
  assert.equal(JSON.parse(await readFile(path, "utf8")).theme, "keep")
})
