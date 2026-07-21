import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { IMPLEMENTED_TOOL_NAMES, toolsForToolsets } from "../src/compat/abap-fs-tools.js"
import { AppError } from "../src/errors.js"
import { runCli } from "../src/index.js"
import { createMcpServer } from "../src/mcp-server.js"
import {
  isV1ToolEnabled,
  V1_READ_ONLY_ANNOTATIONS
} from "../src/mcp/v1/register.js"
import type { V1ReadService } from "../src/mcp/v1/service.js"
import {
  v1ResourcesForToolsets,
  V1_MCP_TOOLSETS,
  v1ToolsForToolsets
} from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

const V0_INSTRUCTIONS = "Call get_connected_systems when connectionId is unknown. Search before reading, and read actual SAP source before suggesting ABAP changes or signatures. Use compact-v1 summaries first; call read_deferred_result only when omitted exact data is needed. Writes are blocked for production profiles; a non-empty allowedPackages list restricts writes to those packages, while an empty list allows all packages. Read current source before editing, provide a transport for non-local packages, then inspect returned diagnostics before activation."

function sortedNames(names: Iterable<string>): string[] {
  return [...names].sort()
}

function firstText(result: CallToolResult): string {
  const content = result.content[0]
  assert.equal(content?.type, "text")
  if (content?.type !== "text") throw new Error("expected text content")
  return content.text
}

function unused<T>(name: string): T {
  return (async () => {
    throw new Error(`${name} was not expected`)
  }) as T
}

function createServiceStub() {
  const calls = {
    getConnectedSystems: 0,
    getSapSystemInfo: 0,
    systemIds: [] as string[],
    includeComponents: [] as boolean[]
  }
  const service: V1ReadService = {
    async getConnectedSystems() {
      calls.getConnectedSystems += 1
      return {
        systems: [{
          id: "DEV100",
          environment: "development",
          credentialAvailable: true
        }]
      }
    },
    async getSapSystemInfo(systemId, includeComponents) {
      calls.getSapSystemInfo += 1
      calls.systemIds.push(systemId)
      calls.includeComponents.push(includeComponents)
      return {
        profileId: "DEV100",
        url: "https://sap.example.test",
        client: "100",
        language: "EN",
        environment: "development",
        username: "DEVELOPER",
        sapRelease: "758",
        systemType: "S/4HANA",
        logicalSystem: "DEVCLNT100",
        clientName: "Development",
        timezone: { name: "KOREA", description: "Korea", utcOffset: "UTC+9" },
        softwareComponents: [{
          component: "S4CORE",
          release: "108",
          extRelease: "0000",
          componentType: "A"
        }],
        discoveryCollections: 12,
        warnings: ["The timezone description was normalized"],
        queryTimestamp: "2026-07-20T00:00:00.000Z"
      }
    },
    getSapCapabilities: unused<V1ReadService["getSapCapabilities"]>("getSapCapabilities"),
    searchObjects: unused<V1ReadService["searchObjects"]>("searchObjects"),
    getObjectLines: unused<V1ReadService["getObjectLines"]>("getObjectLines"),
    getObjectByUri: unused<V1ReadService["getObjectByUri"]>("getObjectByUri")
  }
  return { service, calls }
}

async function connectedClient(
  service: V1ReadService,
  options: Parameters<typeof createMcpServer>[1]
) {
  const server = createMcpServer(service as AbapToolService, options)
  const client = new Client({ name: "v1-system-test", version: "1.0.0" })
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

test("v1 system discovery advertises exact schemas and metadata", async () => {
  const tools = await advertisedTools({ apiVersion: "v1" })
  assert.deepEqual(
    tools.map(tool => tool.name).sort(),
    [...V1_MCP_TOOLSETS.core].sort()
  )

  for (const tool of tools) {
    assert.ok(tool.title?.trim())
    assert.ok(tool.description?.trim())
    assert.deepEqual(tool.annotations, V1_READ_ONLY_ANNOTATIONS)
    assert.deepEqual([...(tool.outputSchema?.required ?? [])].sort(), [
      "schemaVersion",
      "requestId",
      "status",
      "data",
      "warnings"
    ].sort())
  }

  const list = tools.find(tool => tool.name === "sap.system.list")
  const inspect = tools.find(tool => tool.name === "sap.system.inspect")
  assert.equal(list?.title, "List SAP Systems")
  assert.equal(
    list?.description,
    "List configured SAP system IDs and local credential availability."
  )
  assert.deepEqual(list?.inputSchema.properties, {})
  assert.equal(inspect?.title, "Inspect SAP System")
  assert.equal(
    inspect?.description,
    "Read normalized SAP client, release, timezone, and optional software component metadata."
  )
  assert.deepEqual(inspect?.inputSchema.required, ["systemId"])
  assert.equal(
    (inspect?.inputSchema.properties?.includeComponents as { default?: boolean }).default,
    false
  )
})

test("API modes preserve v0 instructions and keep v1 instructions self-contained", async t => {
  const { service } = createServiceStub()
  const v0 = await connectedClient(service, { apiVersion: "v0" })
  const v1 = await connectedClient(service, { apiVersion: "v1" })
  t.after(async () => {
    await v0.close()
    await v1.close()
  })

  assert.equal(v0.client.getInstructions(), V0_INSTRUCTIONS)
  assert.match(v1.client.getInstructions() ?? "", /sap\.system\.(list|inspect)/)
  assert.doesNotMatch(v1.client.getInstructions() ?? "", /get_connected_systems|read_deferred_result/)
})

test("v1 system tools reuse shared service methods and return canonical envelopes", async t => {
  const { service, calls } = createServiceStub()
  const connection = await connectedClient(service, {
    apiVersion: "all",
    enabledV0Tools: new Set(["get_connected_systems", "get_sap_system_info"]),
    enabledV1Tools: new Set(["sap.system.list", "sap.system.inspect"])
  })
  t.after(() => connection.close())

  const list = await connection.client.callTool({ name: "sap.system.list", arguments: {} }) as CallToolResult
  assert.equal(calls.getConnectedSystems, 1)
  assert.deepEqual(list.structuredContent, JSON.parse(firstText(list)))
  assert.deepEqual(list.structuredContent?.data, {
    systems: [{
      id: "DEV100",
      environment: "development",
      credentialAvailable: true
    }]
  })

  await connection.client.callTool({ name: "get_connected_systems", arguments: {} })
  assert.equal(calls.getConnectedSystems, 2)

  const inspect = await connection.client.callTool({
    name: "sap.system.inspect",
    arguments: { systemId: " dev100 ", includeComponents: true }
  }) as CallToolResult
  assert.equal(calls.getSapSystemInfo, 1)
  assert.deepEqual(calls.systemIds, ["DEV100"])
  assert.deepEqual(calls.includeComponents, [true])
  assert.deepEqual(inspect.structuredContent, JSON.parse(firstText(inspect)))
  assert.equal(inspect.structuredContent?.systemId, "DEV100")
  assert.equal(inspect.structuredContent?.status, "partial")
  assert.deepEqual(inspect.structuredContent?.warnings, [{
    code: "SAP_SYSTEM_WARNING",
    message: "The timezone description was normalized"
  }])
  const data = inspect.structuredContent?.data as Record<string, unknown>
  assert.equal("profileId" in data, false)
  assert.equal("url" in data, false)
  assert.equal("username" in data, false)
  assert.equal("warnings" in data, false)
})

test("v1 tool filtering uses exact v1 names", () => {
  assert.equal(isV1ToolEnabled("sap.system.list"), true)
  assert.equal(
    isV1ToolEnabled("sap.system.list", new Set(["sap.system.list"])),
    true
  )
  assert.equal(
    isV1ToolEnabled("sap.system.list", new Set(["sap.system.inspect"])),
    false
  )
  assert.equal(
    isV1ToolEnabled("sap.ops.watch.start", new Set(["sap.ops.watch.start"])),
    true
  )
})

test("API version CLI validation rejects before starting a transport", async () => {
  await assert.rejects(
    runCli(["serve", "--api-version"]),
    (error: unknown) => error instanceof AppError && error.code === "OPTION_REQUIRED"
  )
  await assert.rejects(
    runCli(["serve", "--api-version", "v2"]),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_API_VERSION"
  )
  await assert.rejects(
    runCli(["serve", "--api-version", "v1", "--toolsets", "future"]),
    (error: unknown) => error instanceof AppError &&
      error.code === "INVALID_TOOLSET" &&
      assert.deepEqual(error.details, {
        available: ["core", "write", "analysis", "debug", "operations", "artifacts", "all"]
      }) === undefined
  )
})

test("all mode exposes matching v0 and v1 write toolsets", async () => {
  const writeV0Tools = toolsForToolsets(["write"])
  const writeV1Tools = v1ToolsForToolsets(["write"])
  const tools = await advertisedTools({
    apiVersion: "all",
    enabledV0Tools: writeV0Tools,
    enabledV1Tools: writeV1Tools,
    enabledV1Resources: v1ResourcesForToolsets(["write"])
  })
  assert.deepEqual(
    sortedNames(tools.map(tool => tool.name)),
    sortedNames([
      ...IMPLEMENTED_TOOL_NAMES.filter(name => writeV0Tools.has(name)),
      ...V1_MCP_TOOLSETS.write
    ])
  )
})
