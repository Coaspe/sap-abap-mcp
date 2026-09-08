import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { getEncoding } from "js-tiktoken"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { resolveServeToolSelection } from "../dist/src/mcp/tool-selection.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const option = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const arcPath = option("--arc-path")
if (!arcPath) throw new Error("--arc-path must point to an inspected ARC-1 package with dependencies installed; this script imports its schema code")
const root = resolve(arcPath)
const metadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
if (metadata.name !== "arc-1") throw new Error("Expected an arc-1 package")
const toolsPath = resolve(root, "dist/handlers/tools.js")
const { getToolDefinitions } = await import(pathToFileURL(toolsPath).href)
const { DEFAULT_CONFIG } = await import(pathToFileURL(resolve(root, "dist/server/types.js")).href)
const encoding = getEncoding("o200k_base")
const measure = (scenario, tools) => ({
  scenario, toolCount: tools.length,
  toolArrayBytes: Buffer.byteLength(JSON.stringify(tools)),
  toolsListBytes: Buffer.byteLength(JSON.stringify({ tools })),
  toolArrayTokens: encoding.encode(JSON.stringify(tools), [], []).length,
  names: tools.map(tool => tool.name)
})
const arc = []
for (const [scenario, overrides] of [
  ["standard-default", {}],
  ["standard-write-data-git-enabled", { allowWrites: true, allowDataPreview: true, allowFreeSQL: true, allowTransportWrites: true, allowGitWrites: true }],
  ["hyperfocused-default", { toolMode: "hyperfocused" }]
]) arc.push(measure(scenario, getToolDefinitions({ ...DEFAULT_CONFIG, ...overrides }, undefined, undefined, { nullableOptionals: false })))

const ours = []
for (const preset of ["adaptive", "minimal", "single"]) {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("Schema benchmark must not access SAP") }
  })
  const server = createMcpServer(service, { apiVersion: "v1", ...resolveServeToolSelection("v1", undefined, preset) })
  const client = new Client({ name: "surface-comparison", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    ours.push(measure(preset, (await client.listTools()).tools))
  } finally {
    await client.close()
    await server.close()
  }
}
const report = {
  generatedAt: new Date().toISOString(), tokenizer: "o200k_base",
  method: "ARC-1 published schema factory, unknown SAP capabilities, no plugins/auth filtering; our real in-memory MCP tools/list. No SAP calls or task executions. Defaults differ in permissions and functionality.",
  arcPackage: { name: metadata.name, version: metadata.version,
    toolsModuleSha256: createHash("sha256").update(await readFile(toolsPath)).digest("hex") },
  arc, ours
}
const json = JSON.stringify(report, null, 2)
if (option("--output")) await writeFile(resolve(option("--output")), `${json}\n`)
console.log(json)
