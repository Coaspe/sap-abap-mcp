import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer } from "../src/mcp-server.js"
import { V1_MCP_TOOLSETS, v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

interface RecordedCall {
  method: string
  input: unknown
}

function method(
  calls: RecordedCall[],
  name: string
): (input: unknown) => Promise<Record<string, unknown>> {
  return async input => {
    calls.push({ method: name, input })
    return { connectionId: "DEV100", method: name }
  }
}

function createCoreService() {
  const calls: RecordedCall[] = []
  const service = {
    getObjectInfo: method(calls, "getObjectInfo"),
    getObjectWorkspaceUri: method(calls, "getObjectWorkspaceUri"),
    openObject: method(calls, "openObject"),
    findWhereUsed: method(calls, "findWhereUsed"),
    inspectCode: method(calls, "inspectCode"),
    getAbapDiagnostics: method(calls, "getAbapDiagnostics"),
    getBatchLines: method(calls, "getBatchLines"),
    searchObjectLines: method(calls, "searchObjectLines"),
    manageTextElements: method(calls, "manageTextElements"),
    getObjectUrl: method(calls, "getObjectUrl")
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["core"]),
    enabledV1Resources: new Set()
  })
  const client = new Client({ name: "v1-core-tools", version: "1.0.0" })
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

function text(result: CallToolResult): string {
  const content = result.content[0]
  assert.equal(content?.type, "text")
  if (content?.type !== "text") throw new Error("expected text content")
  return content.text
}

test("the complete core toolset is advertised with action-free v1 contracts", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["core"]),
    enabledV1Resources: new Set()
  })
  assert.deepEqual(
    tools.map(tool => tool.name).sort(),
    [...V1_MCP_TOOLSETS.core].sort()
  )
  assert.equal(tools.length, 20)
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
    assert.equal("action" in (tool.inputSchema.properties ?? {}), false, tool.name)
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name)
    assert.equal(tool.annotations?.destructiveHint, false, tool.name)
  }
})

test("core adapters call the shared service once with normalized fixed operations", async t => {
  const { service, calls } = createCoreService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const invocations: Array<{ name: string; arguments: Record<string, unknown> }> = [
    {
      name: "sap.repository.inspect",
      arguments: { systemId: " dev100 ", objectName: "ZCL_DEMO", includeStructure: true }
    },
    {
      name: "sap.repository.resolve",
      arguments: { systemId: "dev100", objectName: "ZCL_DEMO", includeSourceSummary: false }
    },
    {
      name: "sap.repository.resolve",
      arguments: { systemId: "dev100", objectName: "ZCL_DEMO", includeSourceSummary: true }
    },
    {
      name: "sap.repository.where_used",
      arguments: { systemId: "dev100", objectName: "ZCL_DEMO", includeSnippets: true }
    },
    {
      name: "sap.semantic.complete",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source", elementDetails: false }
    },
    {
      name: "sap.semantic.complete",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source", elementDetails: true }
    },
    {
      name: "sap.semantic.components",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source" }
    },
    {
      name: "sap.semantic.definition",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source", implementation: true }
    },
    {
      name: "sap.semantic.documentation",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source" }
    },
    {
      name: "sap.semantic.format_preview",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source" }
    },
    {
      name: "sap.semantic.hierarchy",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source", superTypes: true }
    },
    {
      name: "sap.semantic.quick_fixes",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source" }
    },
    {
      name: "sap.source.diagnose",
      arguments: { systemId: "dev100", fileUri: "/sap/bc/adt/source", severity: "E" }
    },
    {
      name: "sap.source.read_batch",
      arguments: {
        systemId: "dev100",
        requests: [{ objectName: "ZCL_DEMO", startLine: 2, lineCount: 4 }]
      }
    },
    {
      name: "sap.source.search",
      arguments: {
        systemId: "dev100",
        objectName: "ZCL_DEMO",
        searchTerm: "SELECT",
        regularExpression: true
      }
    },
    {
      name: "sap.text_elements.read",
      arguments: {
        systemId: "dev100",
        objectName: "ZREPORT",
        objectType: "PROGRAM",
        category: "symbols"
      }
    },
    {
      name: "sap.ui.object_url",
      arguments: { systemId: "dev100", objectName: "ZREPORT", objectType: "PROG/P" }
    }
  ]

  for (const invocation of invocations) {
    const result = await connection.client.callTool(invocation) as CallToolResult
    assert.equal(result.isError, undefined, invocation.name)
    assert.deepEqual(result.structuredContent, JSON.parse(text(result)), invocation.name)
    assert.equal(result.structuredContent?.systemId, "DEV100", invocation.name)
  }

  assert.deepEqual(calls, [
    {
      method: "getObjectInfo",
      input: {
        connectionId: "DEV100",
        objectName: "ZCL_DEMO",
        includeStructure: true
      }
    },
    {
      method: "getObjectWorkspaceUri",
      input: { connectionId: "DEV100", objectName: "ZCL_DEMO", objectType: "PROG/P" }
    },
    {
      method: "openObject",
      input: { connectionId: "DEV100", objectName: "ZCL_DEMO" }
    },
    {
      method: "findWhereUsed",
      input: {
        connectionId: "DEV100",
        objectName: "ZCL_DEMO",
        maxResults: 50,
        includeSnippets: true,
        startIndex: 0
      }
    },
    {
      method: "inspectCode",
      input: {
        action: "completion",
        connectionId: "DEV100",
        fileUri: "/sap/bc/adt/source",
        line: 1,
        column: 0,
        implementation: false,
        superTypes: false,
        startIndex: 0,
        maxResults: 50
      }
    },
    {
      method: "inspectCode",
      input: {
        action: "completion_element",
        connectionId: "DEV100",
        fileUri: "/sap/bc/adt/source",
        line: 1,
        column: 0,
        implementation: false,
        superTypes: false,
        startIndex: 0,
        maxResults: 50
      }
    },
    ...[
      "components",
      "definition",
      "documentation",
      "format_preview",
      "type_hierarchy",
      "quick_fixes"
    ].map((action, index) => ({
      method: "inspectCode",
      input: {
        action,
        connectionId: "DEV100",
        fileUri: "/sap/bc/adt/source",
        line: 1,
        column: 0,
        implementation: index === 1,
        superTypes: index === 4,
        startIndex: 0,
        maxResults: 50
      }
    })),
    {
      method: "getAbapDiagnostics",
      input: {
        connectionId: "DEV100",
        fileUri: "/sap/bc/adt/source",
        startIndex: 0,
        maxResults: 100,
        severity: "E"
      }
    },
    {
      method: "getBatchLines",
      input: {
        connectionId: "DEV100",
        requests: [{ objectName: "ZCL_DEMO", startLine: 1, lineCount: 4 }]
      }
    },
    {
      method: "searchObjectLines",
      input: {
        connectionId: "DEV100",
        objectName: "ZCL_DEMO",
        searchTerm: "SELECT",
        contextLines: 3,
        isRegexp: true,
        maxObjects: 1,
        startIndex: 0,
        maxResults: 50
      }
    },
    {
      method: "manageTextElements",
      input: {
        action: "read",
        connectionId: "DEV100",
        objectName: "ZREPORT",
        objectType: "PROGRAM",
        category: "symbols"
      }
    },
    {
      method: "getObjectUrl",
      input: {
        connectionId: "DEV100",
        objectName: "ZREPORT",
        objectType: "PROG/P"
      }
    }
  ])
})
