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

function createOperationsService() {
  const calls: RecordedCall[] = []
  const operation = (method: string) => async (input: unknown) => {
    calls.push({ method, input })
    return { connectionId: "DEV100", method }
  }
  const service = {
    runAbapApplication: operation("runAbapApplication"),
    manageHeartbeat: operation("manageHeartbeat"),
    analyzeDumps: operation("analyzeDumps"),
    analyzeTraces: operation("analyzeTraces"),
    async exportAdtDiscovery(connectionId: string, mode: string) {
      calls.push({ method: "exportAdtDiscovery", input: { connectionId, mode } })
      return { connectionId: "DEV100", mode }
    },
    runSapTransaction: operation("runSapTransaction")
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["operations"]),
    enabledV1Resources: new Set()
  })
  const client = new Client({ name: "v1-operations-tools", version: "1.0.0" })
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

test("the operations toolset advertises 24 action-free v1 contracts", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["operations"]),
    enabledV1Resources: new Set()
  })
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...V1_MCP_TOOLSETS.operations].sort())
  assert.equal(tools.length, 24)
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
    assert.equal("action" in (tool.inputSchema.properties ?? {}), false, tool.name)
  }
  const discovery = tools.find(tool => tool.name === "sap.system.discovery")
  assert.deepEqual(
    (discovery?.inputSchema.properties?.detailLevel as { enum?: string[] })?.enum,
    ["summary", "full"]
  )
})

test("operations adapters call shared service capabilities with fixed actions", async t => {
  const { service, calls } = createOperationsService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const invocations: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "sap.execution.health", arguments: { systemId: "dev100" } },
    { name: "sap.execution.preview", arguments: { systemId: "dev100", kind: "class", className: "ZCL_DEMO" } },
    { name: "sap.execution.preview", arguments: { systemId: "dev100", kind: "snippet", code: "WRITE / 'OK'." } },
    { name: "sap.ops.watch.history", arguments: {} },
    { name: "sap.ops.watch.start", arguments: {} },
    { name: "sap.ops.watch.status", arguments: {} },
    { name: "sap.ops.watch.stop", arguments: {} },
    { name: "sap.ops.watch.task.add", arguments: { description: "Check B4D", systemId: "dev100" } },
    { name: "sap.ops.watch.task.disable", arguments: { taskId: "task-1" } },
    { name: "sap.ops.watch.task.enable", arguments: { taskId: "task-1" } },
    { name: "sap.ops.watch.task.list", arguments: {} },
    { name: "sap.ops.watch.task.remove", arguments: { taskId: "task-1" } },
    { name: "sap.ops.watch.task.update", arguments: { taskId: "task-1", description: "Updated" } },
    { name: "sap.ops.watch.trigger", arguments: { reason: "manual" } },
    { name: "sap.ops.watch.watchlist.read", arguments: {} },
    { name: "sap.runtime.dump.inspect", arguments: { systemId: "dev100", dumpId: "DUMP-1" } },
    { name: "sap.runtime.dump.list", arguments: { systemId: "dev100" } },
    { name: "sap.runtime.trace.configuration", arguments: { systemId: "dev100" } },
    { name: "sap.runtime.trace.hit_list", arguments: { systemId: "dev100", traceId: "TRACE-1" } },
    { name: "sap.runtime.trace.inspect", arguments: { systemId: "dev100", traceId: "TRACE-1" } },
    { name: "sap.runtime.trace.list", arguments: { systemId: "dev100" } },
    { name: "sap.runtime.trace.statements", arguments: { systemId: "dev100", traceId: "TRACE-1" } },
    { name: "sap.system.discovery", arguments: { systemId: "dev100", detailLevel: "summary" } },
    { name: "sap.system.discovery", arguments: { systemId: "dev100", detailLevel: "full" } },
    { name: "sap.ui.transaction_launch", arguments: { systemId: "dev100", transactionCode: "SE80" } },
    { name: "sap.ui.transaction_url", arguments: { systemId: "dev100", transactionCode: "SE80" } }
  ]

  for (const invocation of invocations) {
    const result = await connection.client.callTool(invocation) as CallToolResult
    assert.equal(result.isError, undefined, invocation.name)
    assert.deepEqual(result.structuredContent, JSON.parse((result.content[0] as { text: string }).text))
  }

  assert.equal(calls.length, 26)
  assert.deepEqual(
    calls.flatMap(call => {
      const input = call.input as Record<string, unknown>
      return typeof input.action === "string" ? [input.action] : []
    }),
    [
      "repl_health", "preview_class", "preview_snippet",
      "history", "start", "status", "stop", "add_task", "disable_task",
      "enable_task", "list_tasks", "remove_task", "update_task", "trigger", "get_watchlist",
      "analyze_dump", "list_dumps",
      "list_configurations", "get_hitlist", "analyze_run", "list_runs", "get_statements"
    ]
  )
  assert.deepEqual(
    calls.filter(call => call.method === "runSapTransaction")
      .map(call => (call.input as { mode: string }).mode),
    ["launch", "url"]
  )
  assert.deepEqual(
    calls.filter(call => call.method === "exportAdtDiscovery").map(call => call.input),
    [
      { connectionId: "DEV100", mode: "summary" },
      { connectionId: "DEV100", mode: "full" }
    ]
  )
})
