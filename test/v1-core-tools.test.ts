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
    return { connectionId: "DEV100", method: name, ...(name === "getBatchLines" ? { results: [] } : {}) }
  }
}

function createCoreService() {
  const calls: RecordedCall[] = []
  const service = {
    readDdic: method(calls, "readDdic"),
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
  assert.equal(tools.length, 21)
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
      name: "sap.ddic.read",
      arguments: { systemId: "dev100", kind: "domain", name: "ZDOMAIN" }
    },
    {
      name: "sap.repository.inspect",
      arguments: {
        systemId: " dev100 ",
        objectName: "ZCL_DEMO",
        includeStructure: true,
        includeChildren: true,
        childStartIndex: 10,
        childLimit: 25
      }
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
      method: "readDdic",
      input: { connectionId: "DEV100", kind: "domain", name: "ZDOMAIN" }
    },
    {
      method: "getObjectInfo",
      input: {
        connectionId: "DEV100",
        objectName: "ZCL_DEMO",
        includeStructure: true,
        includeChildren: true,
        includeEnhancements: false,
        includeEnhancementSource: false,
        childStartIndex: 10,
        childMaxResults: 25
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

test("component navigation validates bounded paths and forwards filters", async () => {
  const { service, calls } = createCoreService()
  const harness = await connectedClient(service)
  try {
    const args = { systemId: "dev100", fileUri: "/sap/bc/adt/source" }
    const result = await harness.client.callTool({
      name: "sap.semantic.components",
      arguments: { ...args, componentPath: [" /NS/IF_DEMO~RUN "], visibility: "public", startIndex: 1, limit: 2 }
    })
    assert.notEqual(result.isError, true)
    assert.deepEqual(calls[0], { method: "inspectCode", input: {
      action: "components", connectionId: "DEV100", fileUri: args.fileUri,
      line: 1, column: 0, implementation: false, superTypes: false,
      startIndex: 1, maxResults: 2, componentPath: ["/NS/IF_DEMO~RUN"], visibility: "public"
    } })
    for (const invalid of [
      { componentPath: [" "] },
      { componentPath: Array(9).fill("RUN") },
      { componentPath: ["X".repeat(257)] },
      { componentPath: "RUN" },
      { visibility: "package" }
    ]) {
      const rejected = await harness.client.callTool({ name: "sap.semantic.components", arguments: { ...args, ...invalid } })
      assert.equal(rejected.isError, true)
    }
    assert.equal(calls.length, 1)
  } finally {
    await harness.close()
  }
})

test("repository inspection forwards bounded KTD page requests", async () => {
  const { service, calls } = createCoreService()
  const harness = await connectedClient(service)
  try {
    const args = { systemId: "dev100", objectName: "ZCL_DEMO" }
    const result = await harness.client.callTool({ name: "sap.repository.inspect", arguments: { ...args, documentation: {} } })
    assert.notEqual(result.isError, true)
    assert.deepEqual((calls[0]!.input as any).documentation, { offset: 0, maxChars: 8000 })
    for (const documentation of [{ offset: -1 }, { maxChars: 16001 }, { maxChars: 0 }, { unexpected: true }]) {
      const invalid = await harness.client.callTool({ name: "sap.repository.inspect", arguments: { ...args, documentation } })
      assert.equal(invalid.isError, true)
    }
    assert.equal(calls.length, 1)
  } finally { await harness.close() }
})

test("public API view is forwarded through the existing semantic tool", async () => {
  const { service, calls } = createCoreService()
  const harness = await connectedClient(service)
  try {
    const result = await harness.client.callTool({ name: "sap.semantic.components", arguments: {
      systemId: "DEV100", fileUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main", publicApi: true, definitionName: "LCL_DEMO", includeRelated: true, documentation: {}, ifNoneMatch: "a".repeat(64), limit: 10
    } })
    assert.notEqual(result.isError, true)
    assert.equal((calls[0]!.input as any).publicApi, true)
    assert.equal((calls[0]!.input as any).definitionName, "LCL_DEMO")
    assert.equal((calls[0]!.input as any).includeRelated, true)
    assert.deepEqual((calls[0]!.input as any).documentation, { offset: 0, maxChars: 8000 })
    assert.equal((calls[0]!.input as any).ifNoneMatch, "a".repeat(64))
    assert.equal((calls[0]!.input as any).maxResults, 10)
  } finally { await harness.close() }
})


test("v1 batch replies preserve one-based requests and distinguish partial results", async () => {
  for (const outcome of ["complete", "truncated", "failed", "deferred"] as const) {
    const { service } = createCoreService()
    service.getBatchLines = async input => {
      assert.equal(input.requests[0]!.startLine, 8)
      return { connectionId: input.connectionId, count: 1, requestedLines: 2,
        sourceByteLimit: 65536, returnedSourceBytes: (outcome === "failed" || outcome === "deferred") ? 0 : 4,
        truncated: outcome === "truncated", results: [(outcome === "failed" || outcome === "deferred")
          ? { request: input.requests[0], ok: false, error: "Not completed", ...(outcome === "deferred" ? { deferred: true } : {}) }
          : { request: input.requests[0], ok: true, result: { object: { name: "ZCL_DEMO", type: "CLAS/OC" },
            sourceUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main", code: "code", startLine: 9,
            endLine: 9, nextLine: 10, truncated: outcome === "truncated" } }]
      } as any
    }
    const harness = await connectedClient(service)
    try {
      const result = await harness.client.callTool({ name: "sap.source.read_batch", arguments: {
        systemId: "DEV100", requests: [{ objectName: "ZCL_DEMO", startLine: 9, lineCount: 2 }]
      } }) as CallToolResult
      assert.notEqual(result.isError, true)
      assert.equal(result.structuredContent?.status, outcome === "complete" ? "succeeded" : "partial")
      const data = result.structuredContent?.data as any
      assert.equal(data.results[0].request.startLine, 9)
      assert.equal(data.results[0].request.lineCount, 2)
      if (outcome === "deferred") assert.equal(data.results[0].deferred, true)
      if (outcome === "complete" || outcome === "truncated") assert.equal(data.results[0].result.nextLine, 10)
    } finally { await harness.close() }
  }
})
