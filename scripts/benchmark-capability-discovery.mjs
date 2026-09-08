import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { resolveServeToolSelection } from "../dist/src/mcp/tool-selection.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const outputIndex = process.argv.indexOf("--output")
const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputIndex >= 0 && (!output || output.startsWith("--"))) throw new Error("--output requires a path")
const encoding = process.argv.includes("--tokens")
  ? (await import("js-tiktoken")).getEncoding("o200k_base") : undefined
const measure = value => {
  // Both textual and structured envelopes contain the generated request UUID.
  const json = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    "00000000-0000-0000-0000-000000000000")
  return { bytes: Buffer.byteLength(json), ...(encoding ? { tokens: encoding.encode(json, [], []).length } : {}) }
}
const cases = [
  { query: "sap.semantic.components", expected: "sap.semantic.components", exact: true },
  { query: "where used", expected: "sap.repository.where_used" },
  { query: "syntax check", expected: "sap.source.diagnose" },
  { query: "check syntax", expected: "sap.source.diagnose" },
  { query: "unit tests", expected: "sap.quality.unit_test" },
  { query: "includeRelated", expected: "sap.semantic.components" },
  { query: "KTD", expected: "sap.semantic.components" },
  { query: "jumpToLine", expected: "sap.debug.step", roles: ["developer", "admin"] },
  { query: "upsert", expected: "sap.classic.write", roles: ["developer", "admin"] },
  { query: "sarif", expected: "sap.transport.assess" },
  { query: "sap.transport.release", name: "sap.transport.release", expected: "sap.transport.release", roles: ["admin"], exact: true },
  { query: "qzxv9876plmk", expected: null }
]
const runs = []
const failures = []
for (const preset of ["adaptive", "minimal", "single"]) {
  for (const role of ["viewer", "developer", "admin"]) {
    const service = new AbapToolService({
      async listConnections() { throw new Error("Discovery must not read configured systems") },
      async getClient() { throw new Error("Discovery must not call SAP") }
    })
    const server = createMcpServer(service, { apiVersion: "v1", role, ...resolveServeToolSelection("v1", undefined, preset) })
    const client = new Client({ name: "discovery-benchmark", version: "1" })
    const [a, b] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(b)
      await client.connect(a)
      const tools = (await client.listTools()).tools
      const queries = []
      for (const fixture of cases) {
        const args = { query: fixture.query, ...(fixture.name ? { name: fixture.name } : {}), limit: 5 }
        const request = preset === "single"
          ? { name: "sap", arguments: { name: "search", arguments: args } }
          : { name: "sap.capability.search", arguments: args }
        const result = await client.callTool(request)
        assert.notEqual(result.isError, true)
        const names = result.structuredContent.data.tools.map(tool => tool.name)
        const visible = fixture.expected !== null && (!fixture.roles || fixture.roles.includes(role))
        const rank = fixture.expected === null || !names.includes(fixture.expected) ? null : names.indexOf(fixture.expected) + 1
        const passed = visible ? rank !== null && (!fixture.exact || (rank === 1 && names.length === 1))
          : fixture.expected === null ? names.length === 0 : rank === null
        if (!passed) failures.push({ preset, role, query: fixture.query, expected: fixture.expected, visible, names })
        queries.push({ query: fixture.query, expected: fixture.expected, visible, rank, passed,
          names, request: measure(request), response: measure(result) })
      }
      runs.push({ preset, role, toolCount: tools.length, fixedSchema: measure(tools), queries })
    } finally { await client.close(); await server.close() }
  }
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(),
  tokenizer: encoding ? "o200k_base" : null, liveSapCalls: 0, modelCalls: 0,
  method: "Real in-memory MCP discovery; authored English query fixtures; UUID-normalized minified requests and complete results. Not an LLM success-rate benchmark. Schemas counted once per session; each query reported separately.",
  exclusions: ["initialization and JSON-RPC framing", "model billing and conversation replay", "SAP calls and latency"],
  passed: failures.length === 0, failures, runs }
const json = `${JSON.stringify(report, null, 2)}\n`
if (output) await writeFile(output, json)
console.log(json)
if (failures.length) process.exitCode = 1
