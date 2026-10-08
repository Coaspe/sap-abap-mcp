import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const [directory, ...extra] = process.argv.slice(2)
if (!directory || extra.length) throw new Error("Usage: node scripts/check-mcpb-runtime.mjs <unpacked-bundle-directory>")
const root = resolve(directory)
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"))
assert.equal(manifest.server.type, "node")
assert.equal(manifest.server.mcp_config.command, "node")
const args = manifest.server.mcp_config.args.map(value => value.replaceAll("${__dirname}", root))
assert.ok(args.includes("--onboard-if-empty"))
const runs = []
for (const { existing, openSetup } of [
  { existing: false, openSetup: false },
  { existing: true, openSetup: false },
  { existing: true, openSetup: true }
]) {
  const profiles = await mkdtemp(join(tmpdir(), "sap-mcpb-runtime-profiles-"))
  const id = `MCPB_${randomUUID().split("-")[0].toUpperCase()}`
  const profile = { id, url: "https://sap.example.test", client: "100", username: "FIXTURE",
    authType: "basic", language: "EN", environment: "development", readOnly: true,
    allowedPackages: [], allowDataQueries: false }
  if (existing) await writeFile(join(profiles, "profiles.json"), JSON.stringify({ version: 2, profiles: [profile] }))
  const client = new Client({ name: "mcpb-clean-runtime", version: "1" })
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: root,
    env: { PATH: "", SAP_ABAP_MCP_HOME: profiles, SAP_ABAP_MCP_OPEN_SETUP: String(openSetup) }, stderr: "pipe" })
  let stderr = ""
  transport.stderr.on("data", data => { stderr += data.toString() })
  let setupOrigin
  try {
    await client.connect(transport)
    assert.equal(client.getServerVersion().version, manifest.version)
    const tools = (await client.listTools()).tools
    assert.deepEqual(tools.map(tool => tool.name).sort(), manifest.tools.map(tool => tool.name).sort())
    const batch = await client.callTool({ name: "sap.capability.describe", arguments: { name: "sap.source.read_batch" } })
    assert.equal(batch.isError, undefined)
    assert.equal(batch.structuredContent.data.capability.inputSchema.properties.requests.items.properties.ifNoneMatch.pattern, "^[0-9a-f]{64}$")
    const described = await client.callTool({ name: "sap.capability.describe", arguments: { name: "sap.system.list" } })
    const hash = described.structuredContent.data.capability.schemaHash
    const listed = await client.callTool({ name: "sap.capability.invoke_read",
      arguments: { name: "sap.system.list", schemaHash: hash, arguments: {} } })
    assert.equal(listed.isError, undefined)
    const systems = listed.structuredContent.data.systems
    assert.equal(systems.length, existing ? 1 : 0)
    if (existing) assert.equal(systems[0].readOnly, true)
    if (existing) {
      const inspect = await client.callTool({ name: "sap.capability.describe", arguments: { name: "sap.system.inspect" } })
      const required = await client.callTool({ name: "sap.capability.invoke_read", arguments: {
        name: "sap.system.inspect", schemaHash: inspect.structuredContent.data.capability.schemaHash,
        arguments: { systemId: id }
      } })
      assert.equal(required.isError, true)
      const error = JSON.parse(required.content.find(item => item.type === "text").text)
      assert.equal(error.code, "AUTH_REQUIRED")
      assert.match(error.recovery.message, /Open SAP setup on startup/)
      assert.doesNotMatch(error.message, /Run: sap-abap-mcp/)
    }
    if (!existing || openSetup) {
      const setup = stderr.match(/SAP setup: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)?.[1]
      assert.ok(setup, "First run or explicit reopening must provide a local setup URL")
      const url = new URL(setup)
      setupOrigin = url.origin
      const headers = { "x-onboard-token": url.searchParams.get("token") }
      const status = await (await fetch(`${url.origin}/api/status`, { headers })).json()
      assert.equal(status.hostManaged, true)
      assert.deepEqual(status.clients, [])
      assert.equal(status.environment.npm.installed, false)
      assert.equal(status.profiles.length, existing ? 1 : 0)
      if (existing) {
        assert.equal(status.profiles[0].id, id)
        assert.equal(status.profiles[0].credentialAvailable, false)
      }
      const page = await fetch(`${setup}&lang=en`)
      assert.equal(page.status, 200)
      assert.match(await page.text(), /No extra CLI installation or MCP registration is needed/)
      const finish = await fetch(`${url.origin}/api/finish`, { method: "POST",
        headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ profileId: id }) })
      assert.equal(finish.status, 409)
    } else assert.doesNotMatch(stderr, /SAP setup:/)
    runs.push({ profiles: existing ? "existing" : "empty", tools: tools.length,
      serverVersion: client.getServerVersion().version, setupRequested: openSetup,
      setupServerStarted: !existing || openSetup,
      conditionalBatchSchemaAvailable: true,
      noSapCalls: true, noUserConfigurationChanges: true })
  } finally {
    await client.close()
    await rm(profiles, { recursive: true, force: true })
  }
  if (setupOrigin) await assert.rejects(fetch(setupOrigin, { signal: AbortSignal.timeout(2000) }))
}
console.log(JSON.stringify({ passed: true, node: process.version, platform: process.platform,
  environment: "Absolute host Node executable, empty PATH, standalone bundled files",
  claudeDesktopApplicationTested: false, liveSapCalls: 0, modelCalls: 0, runs }, null, 2))
