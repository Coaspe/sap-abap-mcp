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

function operation(calls: RecordedCall[], name: string) {
  return async (input: unknown) => {
    calls.push({ method: name, input })
    return { connectionId: "DEV100", method: name }
  }
}

function createAnalysisService() {
  const calls: RecordedCall[] = []
  const service = {
    executeDataQuery: operation(calls, "executeDataQuery"),
    manageAbapGit: operation(calls, "manageAbapGit"),
    async getAtcDecorations(fileUri: string | undefined, startIndex: number, maxResults: number) {
      calls.push({ method: "getAtcDecorations", input: { fileUri, startIndex, maxResults } })
      return { findings: [] }
    },
    runAtcAnalysis: operation(calls, "runAtcAnalysis"),
    async runUnitTests(objectName: string, connectionId: string, detailLevel: string) {
      calls.push({ method: "runUnitTests", input: { objectName, connectionId, detailLevel } })
      return { connectionId: "DEV100", tests: [] }
    },
    manageRap: operation(calls, "manageRap"),
    refactorCode: operation(calls, "refactorCode"),
    compareSystems: operation(calls, "compareSystems"),
    dependencyGraph: operation(calls, "dependencyGraph"),
    manageTransportRequests: operation(calls, "manageTransportRequests"),
    getVersionHistory: operation(calls, "getVersionHistory"),
    manageVersions: operation(calls, "manageVersions")
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["analysis"]),
    enabledV1Resources: new Set()
  })
  const client = new Client({ name: "v1-analysis-tools", version: "1.0.0" })
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

const RAP_CONTENT = {
  general: { description: "Demo" },
  businessObject: {
    dataModelEntity: { cdsName: "ZI_DEMO" },
    behavior: {
      implementationType: "managed",
      implementationClass: "ZBP_I_DEMO",
      draftTable: ""
    }
  },
  serviceProjection: { name: "ZC_DEMO" },
  businessService: {
    serviceDefinition: { name: "ZUI_DEMO" },
    serviceBinding: { name: "ZUI_DEMO_O2", bindingType: "ODATA" }
  }
}

test("the analysis toolset advertises 30 action-free v1 contracts", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["analysis"]),
    enabledV1Resources: new Set()
  })
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...V1_MCP_TOOLSETS.analysis].sort())
  assert.equal(tools.length, 30)
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
    assert.equal("action" in (tool.inputSchema.properties ?? {}), false, tool.name)
    assert.equal(tool.annotations?.destructiveHint, false, tool.name)
    assert.equal(tool.annotations?.openWorldHint, true, tool.name)
  }
  const preview = tools.find(tool => tool.name === "sap.refactor.preview")
  assert.deepEqual(
    (preview?.inputSchema.properties?.kind as { enum?: string[] })?.enum,
    ["rename", "change_package", "extract_method", "quick_fix", "format"]
  )
  const deletePreview = tools.find(tool => tool.name === "sap.repository.delete.preview")
  assert.ok(deletePreview?.description?.includes("delete"))
  assert.deepEqual(deletePreview?.inputSchema.required?.sort(), ["fileUri", "systemId"])
  const dataQuery = tools.find(tool => tool.name === "sap.data.query")
  assert.ok(dataQuery?.inputSchema.properties?.data)
  assert.ok(dataQuery?.inputSchema.properties?.webviewId)
  assert.ok(dataQuery?.inputSchema.properties?.resetSorting)
  assert.ok(dataQuery?.inputSchema.properties?.resetFilters)
})

test("data query preserves structured and cached-view transformations", async t => {
  const { service, calls } = createAnalysisService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  for (const arguments_ of [{
    systemId: "dev100",
    data: {
      columns: [{ name: "MANDT", type: "CHAR", description: "Client" }],
      values: [{ MANDT: "100" }]
    },
    displayMode: "internal",
    rowRange: { start: 0, end: 1 },
    resetSorting: true,
    resetFilters: true
  }, {
    systemId: "dev100",
    webviewId: "view-1",
    displayMode: "ui",
    sortColumns: [{ column: "MANDT", direction: "desc" }],
    filters: [{ column: "MANDT", value: "100" }]
  }]) {
    const result = await connection.client.callTool({
      name: "sap.data.query",
      arguments: arguments_
    }) as CallToolResult
    assert.equal(result.isError, undefined)
  }

  assert.deepEqual(calls.map(call => call.input), [{
    connectionId: "DEV100",
    data: {
      columns: [{ name: "MANDT", type: "CHAR", description: "Client" }],
      values: [{ MANDT: "100" }]
    },
    displayMode: "internal",
    maxRows: 1000,
    rowRange: { start: 0, end: 1 },
    resetSorting: true,
    resetFilters: true
  }, {
    connectionId: "DEV100",
    webviewId: "view-1",
    displayMode: "ui",
    maxRows: 1000,
    sortColumns: [{ column: "MANDT", direction: "desc" }],
    filters: [{ column: "MANDT", value: "100" }]
  }])
})

test("analysis adapters call shared service capabilities with fixed actions", async t => {
  const { service, calls } = createAnalysisService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const invocations: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "sap.data.query", arguments: { systemId: " dev100 ", sql: "SELECT * FROM T000", displayMode: "internal" } },
    { name: "sap.git.check", arguments: { systemId: "dev100", repositoryId: "REPO" } },
    { name: "sap.git.inspect", arguments: { systemId: "dev100", repositoryUrl: "https://example.test/repo.git" } },
    { name: "sap.git.list", arguments: { systemId: "dev100" } },
    { name: "sap.quality.atc.cached", arguments: { fileUri: "adt://dev100/source" } },
    { name: "sap.quality.atc.documentation", arguments: { systemId: "dev100", docUri: "/sap/bc/adt/doc" } },
    { name: "sap.quality.atc.run", arguments: { systemId: "dev100", objectName: "ZCL_DEMO", objectType: "CLAS/OC" } },
    { name: "sap.quality.unit_test", arguments: { systemId: "dev100", objectName: "ZCL_DEMO", detailLevel: "failures" } },
    { name: "sap.rap.availability", arguments: { systemId: "dev100", generatorId: "uiservice" } },
    { name: "sap.rap.binding.inspect", arguments: { systemId: "dev100", serviceBindingName: "ZUI_DEMO_O2" } },
    { name: "sap.rap.defaults", arguments: { systemId: "dev100", generatorId: "uiservice", referenceObjectName: "ZI_DEMO", packageName: "$TMP" } },
    { name: "sap.rap.preview", arguments: { systemId: "dev100", generatorId: "uiservice", referenceObjectName: "ZI_DEMO", packageName: "$TMP", content: RAP_CONTENT } },
    { name: "sap.rap.schema", arguments: { systemId: "dev100", generatorId: "uiservice", referenceObjectName: "ZI_DEMO", packageName: "$TMP" } },
    { name: "sap.rap.validate", arguments: { systemId: "dev100", generatorId: "uiservice", referenceObjectName: "ZI_DEMO", packageName: "$TMP" } },
    { name: "sap.refactor.preview", arguments: { systemId: "dev100", fileUri: "adt://dev100/source", kind: "format" } },
    { name: "sap.repository.delete.preview", arguments: { systemId: "dev100", fileUri: "adt://dev100/source", transport: "DEVK900001" } },
    { name: "sap.repository.compare", arguments: { sourceSystemId: "dev100", targetSystemId: "qas100", objectName: "ZCL_DEMO" } },
    { name: "sap.repository.dependency_graph", arguments: { systemId: "dev100", objectName: "ZCL_DEMO" } },
    { name: "sap.transport.assess", arguments: { systemId: "dev100", transportNumber: "DEVK900001" } },
    { name: "sap.transport.compare", arguments: { systemId: "dev100", transportNumbers: ["DEVK900001", "DEVK900002"] } },
    { name: "sap.transport.inspect", arguments: { systemId: "dev100", transportNumber: "DEVK900001", view: "details" } },
    { name: "sap.transport.list", arguments: { systemId: "dev100" } },
    { name: "sap.transport.object.resolve", arguments: { systemId: "dev100", transportNumber: "DEVK900001", pgmid: "R3TR", objectType: "CLAS", objectName: "ZCL_DEMO" } },
    { name: "sap.transport.user.list", arguments: { systemId: "dev100" } },
    { name: "sap.version.history.compare", arguments: { systemId: "dev100", objectName: "ZCL_DEMO", version1: 1, version2: 2 } },
    { name: "sap.version.history.list", arguments: { systemId: "dev100", objectName: "ZCL_DEMO" } },
    { name: "sap.version.history.read", arguments: { systemId: "dev100", objectName: "ZCL_DEMO", versionNumber: 1 } },
    { name: "sap.version.inactive.list", arguments: { systemId: "dev100" } },
    { name: "sap.version.inactive.read", arguments: { systemId: "dev100", objectName: "ZCL_DEMO" } },
    { name: "sap.version.restore.preview", arguments: { systemId: "dev100", objectName: "ZCL_DEMO", versionNumber: 1, transport: "DEVK900001", activate: true } }
  ]

  for (const invocation of invocations) {
    const result = await connection.client.callTool(invocation) as CallToolResult
    assert.equal(result.isError, undefined, invocation.name)
    assert.deepEqual(result.structuredContent, JSON.parse((result.content[0] as { text: string }).text))
    if (invocation.name === "sap.repository.delete.preview") {
      assert.equal(
        (result.structuredContent?.data as Record<string, unknown>).nextTool,
        "sap.repository.delete.execute"
      )
    }
  }
  assert.equal(calls.length, 30)
  assert.deepEqual(calls.map(call => call.method), [
    "executeDataQuery",
    ...Array(3).fill("manageAbapGit"),
    "getAtcDecorations",
    ...Array(2).fill("runAtcAnalysis"),
    "runUnitTests",
    ...Array(6).fill("manageRap"),
    ...Array(2).fill("refactorCode"),
    "compareSystems",
    "dependencyGraph",
    ...Array(6).fill("manageTransportRequests"),
    ...Array(3).fill("getVersionHistory"),
    ...Array(3).fill("manageVersions")
  ])
  assert.deepEqual(
    calls.flatMap(call => {
      const input = call.input as Record<string, unknown>
      return typeof input.action === "string" ? [input.action] : []
    }),
    [
      "check_repository", "remote_info", "list_repositories",
      "get_documentation", "run_analysis",
      "availability", "service_details", "get_defaults", "preview", "get_schema", "validate",
      "preview_format", "preview_delete",
      "assess_transport", "compare_transports", "get_transport_details",
      "get_user_transports", "resolve_object", "list_system_users",
      "compare_versions", "list_versions", "get_version_source",
      "list_inactive", "get_inactive_source", "preview_restore"
    ]
  )
  assert.equal((calls[13]?.input as { content?: unknown }).content, undefined)
  assert.deepEqual(calls[15]?.input, {
    action: "preview_delete",
    connectionId: "DEV100",
    fileUri: "adt://dev100/source",
    transport: "DEVK900001",
    activate: false
  })
  assert.deepEqual(calls[22]?.input, {
    action: "resolve_object",
    connectionId: "DEV100",
    startIndex: 0,
    maxResults: 50,
    includeObjects: false,
    transportNumber: "DEVK900001",
    pgmid: "R3TR",
    objectType: "CLAS",
    objectName: "ZCL_DEMO"
  })
  assert.equal((calls[29]?.input as { transport: string }).transport, "DEVK900001")
  assert.equal((calls[29]?.input as { activate: boolean }).activate, true)
})
