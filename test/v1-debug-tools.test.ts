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

function createDebugService() {
  const calls: RecordedCall[] = []
  const record = (method: string) => async (input: unknown) => {
    calls.push({ method, input })
    return { connectionId: "DEV100", method }
  }
  const service = {
    async manageDebugSession(
      connectionId: string,
      action: string,
      debugUser?: string,
      terminalMode?: boolean
    ) {
      calls.push({ method: "manageDebugSession", input: { connectionId, action, debugUser, terminalMode } })
      return { connectionId: "DEV100", action }
    },
    manageDebugBreakpoint: record("manageDebugBreakpoint"),
    debugStep: record("debugStep"),
    getDebugVariables: record("getDebugVariables"),
    async getDebugStack(connectionId: string, threadId: number) {
      calls.push({ method: "getDebugStack", input: { connectionId, threadId } })
      return { connectionId: "DEV100", frames: [] }
    },
    async getDebugStatus(connectionId: string) {
      calls.push({ method: "getDebugStatus", input: { connectionId } })
      return { connectionId: "DEV100", attached: false }
    }
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["debug"]),
    enabledV1Resources: new Set()
  })
  const client = new Client({ name: "v1-debug-tools", version: "1.0.0" })
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

test("the debug toolset advertises 10 action-free v1 contracts", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["debug"]),
    enabledV1Resources: new Set()
  })
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...V1_MCP_TOOLSETS.debug].sort())
  assert.equal(tools.length, 10)
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
    assert.equal("action" in (tool.inputSchema.properties ?? {}), false, tool.name)
    assert.equal(tool.annotations?.destructiveHint, false, tool.name)
  }
  const step = tools.find(tool => tool.name === "sap.debug.step")
  assert.deepEqual(
    (step?.inputSchema.properties?.stepType as { enum?: string[] })?.enum,
    ["continue", "stepInto", "stepOver", "stepReturn", "jumpToLine"]
  )
})

test("debug adapters call shared service capabilities with fixed operations", async t => {
  const { service, calls } = createDebugService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const invocations: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "sap.debug.breakpoint.remove", arguments: { systemId: "dev100", fileUri: "adt://dev100/source", lineNumbers: [10] } },
    { name: "sap.debug.breakpoint.set", arguments: { systemId: "dev100", fileUri: "adt://dev100/source", lineNumbers: [10], condition: "SY-SUBRC = 0" } },
    { name: "sap.debug.evaluate", arguments: { systemId: "dev100", frameId: 1, expression: "SY-SUBRC" } },
    { name: "sap.debug.session.inspect", arguments: { systemId: "dev100" } },
    { name: "sap.debug.session.start", arguments: { systemId: "dev100", debugUser: "DEVELOPER" } },
    { name: "sap.debug.session.stop", arguments: { systemId: "dev100" } },
    { name: "sap.debug.stack", arguments: { systemId: "dev100", threadId: 1 } },
    { name: "sap.debug.status", arguments: { systemId: "dev100" } },
    { name: "sap.debug.step", arguments: { systemId: "dev100", stepType: "stepOver", threadId: 1 } },
    { name: "sap.debug.variables", arguments: { systemId: "dev100", frameId: 1, variableName: "LS_DATA" } }
  ]

  for (const invocation of invocations) {
    const result = await connection.client.callTool(invocation) as CallToolResult
    assert.equal(result.isError, undefined, invocation.name)
    assert.deepEqual(result.structuredContent, JSON.parse((result.content[0] as { text: string }).text))
  }

  assert.deepEqual(calls.map(call => call.method), [
    "manageDebugBreakpoint",
    "manageDebugBreakpoint",
    "getDebugVariables",
    "manageDebugSession",
    "manageDebugSession",
    "manageDebugSession",
    "getDebugStack",
    "getDebugStatus",
    "debugStep",
    "getDebugVariables"
  ])
  assert.deepEqual(
    calls.filter(call => call.method === "manageDebugSession")
      .map(call => (call.input as { action: string }).action),
    ["status", "start", "stop"]
  )
  assert.deepEqual(
    calls.filter(call => call.method === "manageDebugBreakpoint")
      .map(call => (call.input as { action: string }).action),
    ["remove", "set"]
  )
})
