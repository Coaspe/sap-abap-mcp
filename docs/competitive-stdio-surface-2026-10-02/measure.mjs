import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { readFile, writeFile, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getEncoding } from "js-tiktoken"

const [snapshotFile, outputFile, ...extra] = process.argv.slice(2)
if (!snapshotFile || !outputFile || extra.length) throw new Error("Usage: node measure.mjs <inspected-package-snapshot.json> <output.json>")
const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"))
const checkout = resolve(import.meta.dirname, "../..")
const encoding = getEncoding("o200k_base")
const metric = value => {
  const json = JSON.stringify(value)
  return { bytes: Buffer.byteLength(json), tokens: encoding.encode(json, [], []).length,
    sha256: createHash("sha256").update(json).digest("hex") }
}
const packagePath = name => {
  const found = snapshot.packages.find(item => item.name === name && item.package)
  if (!found) throw new Error(`Missing inspected package: ${name}`)
  return found.package
}
const localRequests = []
const fixture = createServer((request, response) => {
  localRequests.push({ method: request.method, path: request.url })
  response.writeHead(401, { "Content-Type": "text/plain" }); response.end("Synthetic startup fixture")
})
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve))
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`
const scenarios = [
  ...["default", "minimal", "single", "adaptive", "full"].map(mode => ({
    product: "@coaspe/sap-abap-mcp", scenario: mode, entry: join(checkout, "dist/src/index.js"),
    args: ["serve", ...(mode === "default" ? [] : mode === "full" ? ["--toolsets", "all"] : ["--preset", mode])] })),
  ...["standard", "hyperfocused"].map(mode => ({ product: "arc-1", scenario: mode,
    entry: join(packagePath("arc-1"), "bin/arc1.js"), args: ["--tool-mode", mode],
    env: { SAP_URL: fixtureUrl, SAP_USER: "FIXTURE", SAP_PASSWORD: "synthetic-only", SAP_CLIENT: "100" } })),
  ...["default", "focused"].map(mode => ({ product: "abap-adt-mcp", scenario: mode,
    entry: join(packagePath("abap-adt-mcp"), "dist/index.js"), args: [],
    env: { SAP_SYSTEMS: JSON.stringify({ FIXTURE: { url: fixtureUrl, client: "100", user: "FIXTURE", password: "synthetic-only", authType: "basic" } }),
      ...(mode === "focused" ? { MCP_TOOLSETS: "focused" } : {}) } })),
  ...["default", "readonly"].map(mode => ({ product: "@mcp-abap-adt/core", scenario: mode,
    entry: join(packagePath("@mcp-abap-adt/core"), "bin/mcp-abap-adt.js"),
    args: ["--transport=stdio", ...(mode === "readonly" ? ["--exposition=readonly"] : [])] }))
]
const results = []
try {
  for (const scenario of scenarios) {
    const cwd = await mkdtemp(join(tmpdir(), "sap-surface-fixture-"))
    const client = new Client({ name: "sap-startup-surface-measurement", version: "1" })
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [scenario.entry, ...scenario.args], cwd,
      env: { ...getDefaultEnvironment(), SAP_ABAP_MCP_HOME: cwd, AUTH_BROKER_PATH: cwd,
        XDG_CONFIG_HOME: cwd, ...scenario.env }, stderr: "pipe" })
    let stderr = ""
    transport.stderr.on("data", data => { stderr += data.toString() })
    const started = performance.now(); const requestOffset = localRequests.length
    try {
      await client.connect(transport, { timeout: 20000 })
      const tools = []; let cursor; let pages = 0
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 20000 })
        tools.push(...page.tools); cursor = page.nextCursor
        assert.ok(++pages <= 10, "Unexpected tools pagination")
      } while (cursor)
      assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length)
      const toolMetric = metric(tools)
      const instructions = metric({ instructions: client.getInstructions() ?? "" })
      const source = snapshot.packages.find(item => item.name === scenario.product)
      results.push({ product: scenario.product, scenario: scenario.scenario,
        version: source?.version ?? JSON.parse(await readFile(join(checkout, "package.json"), "utf8")).version,
        state: "measured", toolCount: tools.length, tools: toolMetric, instructions,
        combinedEstimatedTokens: toolMetric.tokens + instructions.tokens,
        names: tools.map(tool => tool.name), toolsPages: pages,
        initializeAndToolsListMs: Math.round(performance.now() - started),
        serverInfo: client.getServerVersion(), serverCapabilities: client.getServerCapabilities(),
        localFixtureRequests: localRequests.slice(requestOffset), stderrBytes: Buffer.byteLength(stderr) })
    } catch (error) {
      results.push({ product: scenario.product, scenario: scenario.scenario, state: "not-measured",
        error: String(error), stderr: stderr.slice(-3000), localFixtureRequests: localRequests.slice(requestOffset) })
    } finally {
      await client.close(); await transport.close()
      results.at(-1).localFixtureRequests = localRequests.slice(requestOffset)
      if (results.at(-1).state === "measured") results.at(-1).stderrBytes = Buffer.byteLength(stderr)
    }
    console.log(`${scenario.product} ${scenario.scenario}: ${results.at(-1).state}`)
  }
} finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)) }
const report = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  arch: process.arch, tokenizer: "o200k_base", method: "Actual published CLI processes, SDK initialize and paginated tools/list; minified tool array plus separate initialization instructions field",
  checkoutStatus: "unreleased; package version is not proof of publication", packages: snapshot.packages,
  liveSapCalls: 0, modelCalls: 0, toolTaskCalls: 0,
  fixture: "Isolated working/config directories; synthetic local 401 endpoint for configured competitors; core inspection-only; ours empty profile store",
  exclusions: ["Identical SAP capabilities, authorization and successful task outcomes", "Model billing and host-native schema caching/search", "Other initialization fields and JSON-RPC framing", "Warm backend discovery and caller-specific filtering", "Startup timing ranking; timings are single diagnostic observations", "General outbound-network monitoring"], results }
await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n")
assert.ok(results.every(result => result.state === "measured"), "At least one scenario could not be measured; inspect output")
