import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer } from "../src/mcp-server.js"
import { V1_MCP_TOOLSETS, v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

interface RecordedCall { method: string; input: unknown }

function createArtifactService() {
  const calls: RecordedCall[] = []
  const operation = (method: string) => async (input: unknown) => {
    calls.push({ method, input })
    return { connectionId: "DEV100", method, outputPath: "/tmp/artifact" }
  }
  const service = {
    async createMermaidDiagram(code: string, diagramType: string, theme: string) {
      calls.push({ method: "createMermaidDiagram", input: { code, diagramType, theme } })
      return { htmlPath: "/tmp/diagram.html", diagramType }
    },
    async detectMermaidDiagramType(code: string) {
      calls.push({ method: "detectMermaidDiagramType", input: { code } })
      return { detectedType: "flowchart" }
    },
    async validateMermaidSyntax(code: string, suppressErrors: boolean) {
      calls.push({ method: "validateMermaidSyntax", input: { code, suppressErrors } })
      return { isValid: true }
    },
    createTestDocumentation: operation("createTestDocumentation"),
    executeDataQuery: operation("executeDataQuery"),
    downloadAbap: operation("downloadAbap"),
    async exportAdtDiscovery(connectionId: string, mode: string) {
      calls.push({ method: "exportAdtDiscovery", input: { connectionId, mode } })
      return { connectionId: "DEV100", outputPath: "/tmp/discovery.json" }
    }
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["artifacts"]),
    enabledV1Resources: new Set(["sap-evidence"])
  })
  const client = new Client({ name: "v1-artifact-tools", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return {
    client,
    async close() {
      await client.close()
      await server.close()
    }
  }
}

test("the artifacts toolset advertises seven action-free v1 contracts", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["artifacts"]),
    enabledV1Resources: new Set()
  })
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...V1_MCP_TOOLSETS.artifacts].sort())
  assert.equal(tools.length, 7)
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
    assert.equal("action" in (tool.inputSchema.properties ?? {}), false, tool.name)
  }
})

test("artifact adapters call shared services and publish session evidence", async t => {
  const { service, calls } = createArtifactService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const invocations: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "sap.artifact.mermaid.create", arguments: { code: "flowchart TD\nA-->B" } },
    { name: "sap.artifact.mermaid.detect", arguments: { code: "flowchart TD\nA-->B" } },
    { name: "sap.artifact.mermaid.validate", arguments: { code: "flowchart TD\nA-->B" } },
    { name: "sap.artifact.test_document.create", arguments: { scenarios: [{ scenarioId: 1, scenarioName: "Demo", scenarioDescription: "Demo scenario", screenshots: [] }] } },
    { name: "sap.data.export", arguments: { systemId: "dev100", webviewId: "view-1", resetSorting: true, resetFilters: true, filePath: "/tmp/data", fileType: "csv" } },
    { name: "sap.source.export", arguments: { systemId: "dev100", source: "ZCL_DEMO", target: "/tmp/source" } },
    { name: "sap.system.discovery.export", arguments: { systemId: "dev100" } }
  ]

  for (const invocation of invocations) {
    const result = await connection.client.callTool(invocation) as CallToolResult
    assert.equal(result.isError, undefined, invocation.name)
    assert.deepEqual(result.structuredContent, JSON.parse((result.content[0] as { text: string }).text))
    const evidenceUri = (
      result.structuredContent?.data as Record<string, unknown> | undefined
    )?.evidenceUri
    assert.equal(typeof evidenceUri, "string", invocation.name)
    const evidence = await connection.client.readResource({ uri: evidenceUri as string })
    assert.equal(evidence.contents[0]?.uri, evidenceUri)
  }

  assert.deepEqual(calls.map(call => call.method), [
    "createMermaidDiagram",
    "detectMermaidDiagramType",
    "validateMermaidSyntax",
    "createTestDocumentation",
    "executeDataQuery",
    "downloadAbap",
    "exportAdtDiscovery"
  ])
  assert.equal((calls[4]?.input as { displayMode: string }).displayMode, "download_to_file")
  assert.equal((calls[4]?.input as { webviewId: string }).webviewId, "view-1")
  assert.equal((calls[4]?.input as { resetSorting: boolean }).resetSorting, true)
  assert.equal((calls[4]?.input as { resetFilters: boolean }).resetFilters, true)
  assert.deepEqual(calls[6]?.input, { connectionId: "DEV100", mode: "file" })
})
