import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { resolveServeToolSelection } from "../dist/src/mcp/tool-selection.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../dist/src/mcp/v1/migration-catalog.js"
import { measureToolSurface } from "../dist/src/mcp/v1/surface-budget.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const TOOLSETS = [
  "all", "core", "write", "analysis", "debug", "operations", "artifacts"
]

const requestedOutputIndex = process.argv.indexOf("--output")
const requestedOutput = requestedOutputIndex >= 0
  ? process.argv[requestedOutputIndex + 1]
  : undefined
if (requestedOutputIndex >= 0 && !requestedOutput) {
  throw new Error("--output requires a file path")
}

async function measure(toolset, apiVersion) {
  const selection = resolveServeToolSelection(apiVersion, [toolset])
  if (apiVersion === "v1" && selection.enabledV1Tools &&
    !V1_IMPLEMENTED_TOOL_NAMES.some(name => selection.enabledV1Tools.has(name))) {
    return {
      apiVersion,
      toolset,
      ...measureToolSurface([]),
      status: "no-implemented-tools"
    }
  }

  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() {
      throw new Error("No SAP call is allowed during schema benchmarking")
    }
  })
  const server = createMcpServer(service, { apiVersion, ...selection })
  const client = new Client({ name: "sap-abap-mcp-benchmark", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const tools = (await client.listTools()).tools
    return {
      apiVersion,
      toolset,
      ...measureToolSurface(tools)
    }
  } finally {
    await client.close()
    await server.close()
  }
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  measurement: "minified UTF-8 MCP tool array",
  liveSapCalls: 0,
  v0Toolsets: [],
  v1Toolsets: [],
  versionedSurfaces: []
}
for (const toolset of TOOLSETS) {
  report.v0Toolsets.push(await measure(toolset, "v0"))
  report.v1Toolsets.push(await measure(toolset, "v1"))
}
report.versionedSurfaces.push(await measure("all", "all"))

const serialized = `${JSON.stringify(report, null, 2)}\n`
if (requestedOutput) {
  const outputPath = resolve(requestedOutput)
  await writeFile(outputPath, serialized, "utf8")
  process.stdout.write(`${outputPath}\n`)
} else {
  process.stdout.write(serialized)
}
