import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { ProfileStore } from "../src/profile-store.js"
import { applyRegistrationRepair, planRegistrationRepair, probeRegistration, readRegistration } from "../src/registration.js"

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "registration 한글 "))
  t.after(() => rm(home, { recursive: true, force: true }))
  const path = join(home, "config.toml")
  const text = `# preserve this comment\nmodel = "owner-choice"\n[mcp_servers.sap-abap]\ncommand = "/removed/node"\nargs = ["/cache/node_modules/@coaspe/sap-abap-mcp/dist/src/index.js", "serve", "--profile", "DEV100", "--preset", "single", "--audit-log", "stderr"]\nstartup_timeout_sec = 45\n[mcp_servers.sap-abap.env]\nSAP_ABAP_MCP_HOME = ${JSON.stringify(home)}\nCUSTOM = "preserved"\n[mcp_servers.other]\ncommand = "custom-wrapper"\nargs = ["unrelated"]\n`
  await writeFile(path, text)
  return { home, path, text, file: await readRegistration("codex", path) }
}

test("repair preview preserves comments, other servers, extra flags, environment and client settings", async t => {
  const f = await fixture(t)
  const plan = planRegistrationRepair(f.file, "codex", "DEV100", f.home, "2.0.1")
  assert.equal(await readFile(f.path, "utf8"), f.text)
  assert.ok(plan.text.startsWith('# preserve this comment\nmodel = "owner-choice"'))
  assert.match(plan.text, /startup_timeout_sec = 45/)
  assert.match(plan.text, /CUSTOM = "preserved"/)
  assert.match(plan.text, /command = "custom-wrapper"/)
  assert.deepEqual(plan.launch.args.slice(-4), ["--preset", "single", "--audit-log", "stderr"])
  assert.ok(plan.launch.args.includes("@coaspe/sap-abap-mcp@2.0.1"))
})

test("repair refuses custom wrappers, another profile, absent profile home and moving versions", async t => {
  const f = await fixture(t)
  for (const launch of [{ ...f.file.launch, command: "owner-wrapper" },
    { ...f.file.launch, args: [f.file.launch.args[0]!, "serve", "--profile=OTHER"] },
    { ...f.file.launch, env: {} }]) {
    assert.throws(() => planRegistrationRepair({ ...f.file, launch }, "codex", "DEV100", f.home))
  }
  assert.throws(() => planRegistrationRepair(f.file, "codex", "DEV100", f.home, "latest"))
  assert.equal(await readFile(f.path, "utf8"), f.text)
})

test("failed or interrupted preflight and concurrent edits never replace the original registration", async t => {
  const f = await fixture(t)
  const plan = planRegistrationRepair(f.file, "codex", "DEV100", f.home)
  await assert.rejects(applyRegistrationRepair(f.file, plan.text, async () => ({ status: "failed" })), { code: "REPAIR_PREFLIGHT_FAILED" })
  await assert.rejects(applyRegistrationRepair(f.file, plan.text, async () => { throw new Error("interrupted") }), /interrupted/)
  assert.equal(await readFile(f.path, "utf8"), f.text)
  const external = `${f.text}\n# external edit\n`
  await assert.rejects(applyRegistrationRepair(f.file, plan.text, async () => {
    await writeFile(f.path, external)
    return { status: "local_ready" }
  }), { code: "REGISTRATION_CHANGED" })
  assert.equal(await readFile(f.path, "utf8"), external)
})

test("successful repair saves a recovery copy and changes only the selected launch", async t => {
  const f = await fixture(t)
  const plan = planRegistrationRepair(f.file, "codex", "DEV100", f.home)
  const applied = await applyRegistrationRepair(f.file, plan.text, async () => ({ status: "local_ready" }))
  assert.equal(applied.applied, true)
  assert.equal(await readFile(applied.backup!, "utf8"), f.text)
  assert.equal(await readFile(f.path, "utf8"), plan.text)
})

test("registration doctor reports removed Node, removed cache entry and real MCP versions separately", async t => {
  const f = await fixture(t)
  const removedNode = await probeRegistration(f.file.launch, "DEV100", f.home)
  assert.equal(removedNode.errorCode, "EXECUTABLE_MISSING")
  const removedCache = await probeRegistration({ ...f.file.launch, command: process.execPath }, "DEV100", f.home)
  assert.equal(removedCache.errorCode, "ENTRY_MISSING")
  await new ProfileStore(f.home).upsert({ id: "DEV100", url: "https://sap.invalid", client: "100", readOnly: true })
  const ready = await probeRegistration({ command: process.execPath,
    args: [fileURLToPath(new URL("../src/index.js", import.meta.url)), "serve", "--profile", "DEV100"],
    env: { SAP_ABAP_MCP_HOME: f.home } }, "DEV100", f.home)
  assert.equal(ready.status, "local_ready")
  assert.equal(ready.initialized, true)
  assert.equal(ready.registeredVersion, ready.wizardVersion)
  assert.equal(ready.sapAuthenticated, false)
})


test("Claude project overrides and disabled servers are not replaced through a user entry", async t => {
  const f = await fixture(t)
  const path = join(f.home, ".claude.json")
  const entry = { command: "npx", args: ["-y", "@coaspe/sap-abap-mcp@2.0.1", "serve"], env: { SAP_ABAP_MCP_HOME: f.home } }
  await writeFile(path, JSON.stringify({ mcpServers: { "sap-abap": entry },
    projects: { [process.cwd()]: { mcpServers: { "sap-abap": entry } } } }))
  await assert.rejects(readRegistration("claude", path), { code: "REGISTRATION_SCOPE_CONFLICT" })
  await writeFile(path, JSON.stringify({ mcpServers: { "sap-abap": entry },
    projects: { [process.cwd()]: { disabledMcpServers: ["sap-abap"] } } }))
  const disabled = await readRegistration("claude", path)
  assert.equal((await probeRegistration(disabled.launch, "DEV100", f.home)).status, "disabled")
  assert.throws(() => planRegistrationRepair(disabled, "claude", "DEV100", f.home), { code: "CUSTOM_REGISTRATION" })
})
