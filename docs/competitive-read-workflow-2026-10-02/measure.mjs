import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getEncoding } from "js-tiktoken"

const [snapshotFile, outputFile, ...extra] = process.argv.slice(2)
if (!snapshotFile || !outputFile || extra.length) throw new Error("Usage: measure.mjs <inspected-package-snapshot.json> <output.json>")
const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"))
const checkout = resolve(import.meta.dirname, "../..")
const encoding = getEncoding("o200k_base")
const digest = value => createHash("sha256").update(value).digest("hex")
const original = ["REPORT z_mcp_fixture.", ...Array.from({ length: 199 }, (_, i) => `WRITE 'Synthetic fixture line ${i + 2}'.`)].join("\n")
const changed = original.replace("fixture line 42", "changed fixture line 42")
const sourcePath = "/sap/bc/adt/programs/programs/z_mcp_fixture/source/main"
let source = original, denied = false
const requests = []
const fixture = createServer((request, response) => {
  const url = new URL(request.url, "http://fixture")
  const path = url.pathname.toLowerCase()
  let status = 404, body = "Unsupported synthetic fixture endpoint", type = "text/plain"
  const headers = { "x-csrf-token": "synthetic-csrf", "cache-control": "private, max-age=0", "set-cookie": "SAP_SESSIONID_FIX_100=synthetic-session; Path=/" }
  if (!["GET", "HEAD"].includes(request.method)) { status = 405; body = "Fixture permits reads only" }
  else if (path === sourcePath) {
    headers.etag = `"${digest(source)}"`
    status = denied ? 403 : request.headers["if-none-match"] === headers.etag ? 304 : 200
    body = status === 200 ? source : status === 403 ? "Synthetic read authorization revoked" : ""
    type = "text/plain; charset=utf-8"
  } else if (["/", "/sap/bc/adt/compatibility/graph", "/sap/bc/adt/discovery", "/sap/bc/adt/core/discovery", "/sap/public/bc/icf/logoff"].includes(path)) {
    status = 200; body = '<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"/>'; type = "application/xml"
  }
  requests.push({ method: request.method, path: url.pathname, query: url.search, status,
    conditional: Boolean(request.headers["if-none-match"]), bodyBytes: request.method === "HEAD" ? 0 : Buffer.byteLength(body) })
  response.writeHead(status, { ...headers, "content-type": type }); response.end(request.method === "HEAD" ? "" : body)
})
await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve))
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`
const metric = value => {
  const json = JSON.stringify(value).replaceAll(fixtureUrl, "http://127.0.0.1:00000")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "00000000-0000-0000-0000-000000000000")
  return { bytes: Buffer.byteLength(json), tokens: encoding.encode(json, [], []).length, sha256: digest(json) }
}
const packagePath = name => {
  const found = snapshot.packages.find(item => item.name === name && item.package)
  if (!found) throw new Error(`Missing inspected package: ${name}`)
  return found.package
}
const scenarios = [
  ...["full", "minimal", "single", "adaptive", "resource-minimal", "resource-single", "known-minimal", "known-single"].map(mode => ({ product: "@coaspe/sap-abap-mcp", scenario: mode,
    entry: join(checkout, "dist/src/index.js"), nativeResource: mode.startsWith("resource-"), args: ["serve", ...(mode === "full" ? ["--toolsets", "all"] : ["--preset", mode.replace(/^(resource|known)-/, "")])],
    env: { SAP_ABAP_MCP_PASSWORD_FIXTURE: "synthetic-only" } })),
  ...["standard", "hyperfocused"].map(mode => ({ product: "arc-1", scenario: mode,
    entry: join(packagePath("arc-1"), "bin/arc1.js"), args: ["--tool-mode", mode],
    env: { SAP_URL: fixtureUrl, SAP_USER: "FIXTURE", SAP_PASSWORD: "synthetic-only", SAP_CLIENT: "100" } })),
  { product: "abap-adt-mcp", scenario: "focused", entry: join(packagePath("abap-adt-mcp"), "dist/index.js"), args: [],
    env: { SAP_SYSTEMS: JSON.stringify({ FIXTURE: { url: fixtureUrl, client: "100", user: "FIXTURE", password: "synthetic-only", authType: "basic", policy: { readOnly: true } } }), MCP_TOOLSETS: "focused" } },
  { product: "@mcp-abap-adt/core", scenario: "default-onprem", entry: join(packagePath("@mcp-abap-adt/core"), "bin/mcp-abap-adt.js"), args: ["--transport=stdio"],
    env: { SAP_URL: fixtureUrl, SAP_USERNAME: "FIXTURE", SAP_PASSWORD: "synthetic-only", SAP_CLIENT: "100", SAP_AUTH_TYPE: "basic", SAP_SYSTEM_TYPE: "onprem" } }
]
const hasSource = (value, expected) => {
  if (typeof value === "string") {
    if (value.includes(expected)) return true
    try { return hasSource(JSON.parse(value), expected) } catch { return false }
  }
  return value !== null && typeof value === "object" && Object.values(value).some(item => hasSource(item, expected))
}
const results = []
try {
  for (const scenario of scenarios) {
    source = original; denied = false
    const cwd = await mkdtemp(join(tmpdir(), "sap-read-workflow-"))
    await writeFile(join(cwd, "profiles.json"), JSON.stringify({ version: 2, profiles: [{ id: "FIXTURE", url: fixtureUrl,
      client: "100", language: "EN", username: "FIXTURE", authType: "basic", environment: "development", readOnly: true,
      allowedPackages: [], allowDataQueries: false }] }))
    if (scenario.product === "@mcp-abap-adt/core") {
      await writeFile(join(cwd, ".env"), Object.entries(scenario.env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n")
      scenario.env.MCP_ENV_PATH = join(cwd, ".env")
    }
    const client = new Client({ name: "identical-offline-read-workflow", version: "1" })
    const transport = new StdioClientTransport({ command: process.execPath, args: [scenario.entry, ...scenario.args], cwd,
      env: { ...getDefaultEnvironment(), SAP_ABAP_MCP_HOME: cwd, AUTH_BROKER_PATH: cwd, XDG_CONFIG_HOME: cwd, ...scenario.env }, stderr: "pipe" })
    let stderr = ""
    transport.stderr.on("data", data => { stderr += data.toString() })
    const record = { product: scenario.product, scenario: scenario.scenario, stages: [], state: "incomplete" }
    results.push(record)
    const startupOffset = requests.length
    const call = async (stage, request, method = "tools/call") => {
      const offset = requests.length
      let result, protocolError = false
      try { result = method === "resources/read" ? await client.readResource(request, { timeout: 20000 })
        : method === "resources/templates/list" ? await client.listResourceTemplates(undefined, { timeout: 20000 })
        : await client.callTool(request, undefined, { timeout: 20000 }) }
      catch (error) { protocolError = true; result = { code: error.code, message: error.message, data: error.data } }
      const entry = { stage, method, request: metric(request), response: metric(result),
        ...(result.content ? { contentField: metric(result.content) } : {}),
        ...(result.contents ? { resourceContentsField: metric(result.contents) } : {}),
        ...(result.structuredContent ? { structuredField: metric(result.structuredContent) } : {}), protocolError,
        fixtureRequests: requests.slice(offset), requestPayload: request, result }
      record.stages.push(entry)
      return entry
    }
    try {
      await client.connect(transport, { timeout: 20000 })
      const tools = []; let cursor
      do { const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 20000 }); tools.push(...page.tools); cursor = page.nextCursor } while (cursor)
      record.toolCount = tools.length; record.fixedSchemas = metric(tools)
      record.instructions = metric({ instructions: client.getInstructions() ?? "" })
      record.startupFixtureRequests = requests.slice(startupOffset)
      let schemaHash, contentHash
      if (scenario.nativeResource) {
        const templates = await call("resource-template-discovery", {}, "resources/templates/list")
        assert.ok(templates.result.resourceTemplates?.some(template => template.name === "sap-adt-source"))
      }
      if (!scenario.nativeResource && scenario.product === "@coaspe/sap-abap-mcp" && scenario.scenario !== "full") {
        const single = scenario.scenario.endsWith("single")
        if (!scenario.scenario.startsWith("known-")) {
        const search = await call("discover", single ? { name: "sap", arguments: { name: "search", arguments: { name: "sap.source.read", limit: 1 } } }
          : { name: "sap.capability.search", arguments: { name: "sap.source.read", limit: 1 } })
        assert.notEqual(search.result.isError, true)
        }
        const description = await call("describe", single ? { name: "sap", arguments: { name: "describe", arguments: { name: "sap.source.read" } } }
          : { name: "sap.capability.describe", arguments: { name: "sap.source.read" } })
        schemaHash = description.result.structuredContent?.data?.capability?.schemaHash
        assert.match(schemaHash, /^[0-9a-f]{64}$/)
      }
      const readRequest = () => {
        if (scenario.product === "@coaspe/sap-abap-mcp") {
          const args = { systemId: "FIXTURE", resourceUri: `adt://fixture${sourcePath}`, startLine: 1, lineCount: 200, ...(contentHash ? { ifNoneMatch: contentHash } : {}) }
          return scenario.scenario === "full" ? { name: "sap.source.read", arguments: args }
            : { name: scenario.scenario.endsWith("single") ? "sap" : "sap.capability.invoke_read",
              arguments: { name: "sap.source.read", schemaHash, arguments: args, ...(scenario.scenario.endsWith("single") ? { risk: "read" } : {}) } }
        }
        if (scenario.product === "arc-1") return scenario.scenario === "standard"
          ? { name: "SAPRead", arguments: { type: "PROG", name: "Z_MCP_FIXTURE", version: "active" } }
          : { name: "SAP", arguments: { action: "read", type: "PROG", name: "Z_MCP_FIXTURE", params: { version: "active" } } }
        if (scenario.product === "abap-adt-mcp") return { name: "getObjectSource", arguments: { system: "FIXTURE", objectSourceUrl: sourcePath, version: "active", startLine: 1, maxLines: 200 } }
        return { name: "GetProgram", arguments: { program_name: "Z_MCP_FIXTURE", version: "active" } }
      }
      let retainedSource
      for (const stage of ["cold-read", "unchanged-recheck", "changed-recheck", "denied-recheck"]) {
        if (stage === "changed-recheck") source = changed
        if (stage === "denied-recheck") denied = true
        const entry = await call(stage, scenario.nativeResource ? { uri: `adt://fixture${sourcePath}` } : readRequest(),
          scenario.nativeResource ? "resources/read" : "tools/call")
        const data = entry.result.structuredContent?.data
        const failed = entry.protocolError || entry.result.isError === true
        const readRequests = entry.fixtureRequests.filter(item => item.path.toLowerCase() === sourcePath && item.method === "GET")
        const matching = hasSource(entry.result, source)
        if (!failed && matching) retainedSource = source
        const unchanged = !failed && data?.notModified === true && data?.contentHash === contentHash && retainedSource === source
        entry.acceptance = stage === "denied-recheck"
          ? { passed: failed && readRequests.some(item => item.status === 403) && !hasSource(entry.result, original) && !hasSource(entry.result, changed), readRefused: failed }
          : { passed: !failed && (matching || unchanged) && readRequests.length > 0, completeCurrentSource: matching || unchanged,
              freshlyCheckedFixture: readRequests.length > 0, retainedBodyReuse: unchanged }
        if (data?.contentHash) contentHash = data.contentHash
      }
      record.state = record.stages.filter(stage => stage.acceptance).every(stage => stage.acceptance.passed) ? "passed" : "incomplete-offline-fixture"
    } catch (error) { record.error = String(error); record.stderrTail = stderr.slice(-2000) }
    finally {
      await client.close(); await transport.close(); await rm(cwd, { recursive: true, force: true })
      record.stderrBytes = Buffer.byteLength(stderr)
      record.mcpOperationCalls = record.stages.length
      record.toolCalls = record.stages.filter(stage => stage.method === "tools/call").length
      record.resourceReads = record.stages.filter(stage => stage.method === "resources/read").length
      record.requestTokens = record.stages.reduce((n, stage) => n + stage.request.tokens, 0)
      record.responseTokens = record.stages.reduce((n, stage) => n + stage.response.tokens, 0)
      record.totalEstimatedTokens = (record.fixedSchemas?.tokens ?? 0) + (record.instructions?.tokens ?? 0) + record.requestTokens + record.responseTokens
      console.log(`${scenario.product} ${scenario.scenario}: ${record.state}; ${record.mcpOperationCalls} MCP operations; ${record.totalEstimatedTokens} estimated tokens`)
    }
  }
} finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)) }
const report = { passed: results.every(result => result.state === "passed"), generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  fixture: { lines: 200, initialSha256: digest(original), changedSha256: digest(changed), method: "Read active full source, freshly recheck unchanged, observe external source change, refuse read after synthetic authorization revocation; one sequential session per configuration." },
  packages: snapshot.packages, tokenizer: "o200k_base", liveSapCalls: 0, modelCalls: 0, sapWrites: 0,
  normalization: "UUIDs and the synthetic loopback origin only; complete tool parameters/results, fixed schemas once and instructions separately.",
  method: "Actual released competitor CLI processes and unreleased local checkout; SDK tool calls against the same loopback ADT fixture. Script chooses known read operations. Minimal/single/adaptive include optional search plus describe; known-* skips optional search. Resource paths include template discovery. These are explicit caller strategies, not model-selected workflows.",
  exclusions: ["Live SAP compatibility and authorization", "Model task selection/correctness, billing and conversation replay", "Host schema caching/tool search and host-native Resource reader schemas", "Other initialize and JSON-RPC framing fields", "SAP latency rankings and ordinary novice setup", "General outbound-network monitoring", "Full T1-T5 acceptance; this is one offline source-read subtask"],
  errors: "Protocol exceptions use their SDK error representation for response estimates; not reconstructed wire JSON.", results }
await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n")

if (!report.passed) process.exitCode = 1
