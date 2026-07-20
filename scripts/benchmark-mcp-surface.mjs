import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { toolsForToolsets } from "../dist/src/compat/abap-fs-tools.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const requestedOutputIndex = process.argv.indexOf("--output")
const requestedOutput = requestedOutputIndex >= 0
  ? process.argv[requestedOutputIndex + 1]
  : undefined
if (requestedOutputIndex >= 0 && !requestedOutput) {
  throw new Error("--output requires a file path")
}

async function measure(toolset) {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("No SAP call is allowed during schema benchmarking") }
  })
  const server = createMcpServer(service, {
    enabledTools: toolsForToolsets([toolset])
  })
  const client = new Client({ name: "sap-abap-mcp-benchmark", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const tools = (await client.listTools()).tools
    const toolBytes = tools.map(tool => ({
      name: tool.name,
      bytes: Buffer.byteLength(JSON.stringify(tool), "utf8")
    })).sort((left, right) => right.bytes - left.bytes)
    return {
      toolset,
      toolCount: tools.length,
      schemaBytes: Buffer.byteLength(JSON.stringify(tools), "utf8"),
      largestTools: toolBytes.slice(0, 10)
    }
  } finally {
    await client.close()
    await server.close()
  }
}

const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  measurement: "minified UTF-8 MCP listTools payload",
  liveSapCalls: 0,
  toolsets: []
}
for (const toolset of ["all", "core", "write", "analysis", "debug", "operations", "artifacts"]) {
  report.toolsets.push(await measure(toolset))
}

const serialized = `${JSON.stringify(report, null, 2)}\n`
if (requestedOutput) {
  const outputPath = resolve(requestedOutput)
  await writeFile(outputPath, serialized, "utf8")
  process.stdout.write(`${outputPath}\n`)
} else {
  process.stdout.write(serialized)
}
