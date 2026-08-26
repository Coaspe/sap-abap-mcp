import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import {
  AuditRecorder,
  type AuditEvent,
  type AuditSink
} from "../src/audit-log.js"
import { createMcpServer } from "../src/mcp-server.js"
import {
  ADAPTIVE_V1_TOOL_NAMES,
  type AdaptiveCapabilityRisk
} from "../src/mcp/v1/adaptive-tools.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import {
  V1_MCP_PRESETS,
  V1_PRESET_RESOURCE_NAMES
} from "../src/mcp/v1/presets.js"
import { AbapToolService } from "../src/tool-service.js"

interface JsonEnvelope {
  requestId?: string
  status?: string
  data?: Record<string, unknown>
  code?: string
}

interface CapabilitySummary {
  name: string
  risk: AdaptiveCapabilityRisk
}

function service(): AbapToolService {
  return new AbapToolService({
    async listConnections() {
      return [{
        id: "DEV100",
        url: "https://sap.example.test",
        client: "100",
        language: "EN",
        environment: "development" as const,
        credentialAvailable: true
      }]
    },
    async getClient() { throw new Error("not used") }
  })
}

function textEnvelope(result: CallToolResult): JsonEnvelope {
  const item = result.content.find(content => content.type === "text")
  assert.equal(item?.type, "text")
  if (item?.type !== "text") throw new Error("expected text content")
  return JSON.parse(item.text) as JsonEnvelope
}

function firstText(result: CallToolResult): string {
  const item = result.content.find(content => content.type === "text")
  assert.equal(item?.type, "text")
  if (item?.type !== "text") throw new Error("expected text content")
  return item.text
}

function resultCode(result: CallToolResult): string | undefined {
  try {
    return (JSON.parse(firstText(result)) as { code?: string }).code
  } catch {
    return undefined
  }
}

async function connectedServer(options: Parameters<typeof createMcpServer>[1]) {
  const server = createMcpServer(service(), options)
  const client = new Client({ name: "adaptive-test", version: "1.0.0" })
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

async function describe(
  client: Client,
  name: string
): Promise<{ schemaHash: string; risk: AdaptiveCapabilityRisk }> {
  const result = await client.callTool({
    name: "sap.capability.describe",
    arguments: { name }
  }) as CallToolResult
  assert.equal(result.isError, undefined)
  const data = textEnvelope(result).data as {
    capability: { schemaHash: string; risk: AdaptiveCapabilityRisk }
  }
  return data.capability
}

test("adaptive exposes compact tools plus five fixed discovery tools", async () => {
  const connection = await connectedServer({
    apiVersion: "v1",
    adaptive: true
  })
  try {
    const names = (await connection.client.listTools()).tools
      .map(tool => tool.name)
      .sort()
    assert.deepEqual(names, [
      ...V1_MCP_PRESETS.compact,
      ...ADAPTIVE_V1_TOOL_NAMES
    ].sort())
  } finally {
    await connection.close()
  }
})

test("adaptive catalog can enumerate every implemented v1 tool without search recall", async () => {
  const connection = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const names: string[] = []
    let cursor: string | undefined
    do {
      const result = await connection.client.callTool({
        name: "sap.capability.search",
        arguments: {
          limit: 50,
          ...(cursor === undefined ? {} : { cursor })
        }
      }) as CallToolResult
      assert.equal(result.isError, undefined)
      const envelope = textEnvelope(result)
      const tools = envelope.data?.tools as CapabilitySummary[]
      names.push(...tools.map(tool => tool.name))
      cursor = (envelope.data?.nextCursor as string | undefined)
    } while (cursor !== undefined)

    assert.deepEqual(names.sort(), [...V1_IMPLEMENTED_TOOL_NAMES].sort())
  } finally {
    await connection.close()
  }
})

test("adaptive describe and invoke preserve direct tool behavior", async () => {
  const adaptive = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  const direct = await connectedServer({ apiVersion: "v1" })
  try {
    const capability = await describe(adaptive.client, "sap.system.list")
    assert.equal(capability.risk, "read")
    assert.match(capability.schemaHash, /^[0-9a-f]{64}$/)

    const adaptiveResult = await adaptive.client.callTool({
      name: "sap.capability.invoke_read",
      arguments: {
        name: "sap.system.list",
        schemaHash: capability.schemaHash,
        arguments: {}
      }
    }) as CallToolResult
    const directResult = await direct.client.callTool({
      name: "sap.system.list",
      arguments: {}
    }) as CallToolResult

    assert.equal(adaptiveResult.isError, directResult.isError)
    assert.deepEqual(
      textEnvelope(adaptiveResult).data,
      textEnvelope(directResult).data
    )
  } finally {
    await adaptive.close()
    await direct.close()
  }
})

test("every implemented tool is describable and routes through its matching gateway", async () => {
  const adaptive = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  const direct = await connectedServer({ apiVersion: "v1" })
  try {
    for (const name of V1_IMPLEMENTED_TOOL_NAMES) {
      const capability = await describe(adaptive.client, name)
      const gatewayName = `sap.capability.invoke_${capability.risk}`
      const adaptiveResult = await adaptive.client.callTool({
        name: gatewayName,
        arguments: {
          name,
          schemaHash: capability.schemaHash,
          arguments: {}
        }
      }) as CallToolResult
      const directResult = await direct.client.callTool({
        name,
        arguments: {}
      }) as CallToolResult

      assert.equal(Boolean(adaptiveResult.isError), Boolean(directResult.isError), name)
      const directText = firstText(directResult)
      if (directText.startsWith("Input validation error:")) {
        assert.equal(firstText(adaptiveResult), directText, name)
      } else if (directResult.isError) {
        assert.equal(resultCode(adaptiveResult), resultCode(directResult), name)
      }
    }
  } finally {
    await adaptive.close()
    await direct.close()
  }
})

test("adaptive rejects stale schemas and the wrong risk gateway", async () => {
  const connection = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const capability = await describe(connection.client, "sap.system.list")
    const stale = await connection.client.callTool({
      name: "sap.capability.invoke_read",
      arguments: {
        name: "sap.system.list",
        schemaHash: "0".repeat(64),
        arguments: {}
      }
    }) as CallToolResult
    assert.equal(stale.isError, true)
    assert.equal(textEnvelope(stale).code, "CAPABILITY_SCHEMA_CHANGED")

    const wrongRisk = await connection.client.callTool({
      name: "sap.capability.invoke_write",
      arguments: {
        name: "sap.system.list",
        schemaHash: capability.schemaHash,
        arguments: {}
      }
    }) as CallToolResult
    assert.equal(wrongRisk.isError, true)
    assert.equal(textEnvelope(wrongRisk).code, "CAPABILITY_RISK_MISMATCH")
  } finally {
    await connection.close()
  }
})

test("adaptive viewer sessions cannot discover or call mutation gateways", async () => {
  const connection = await connectedServer({
    apiVersion: "v1",
    role: "viewer",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const names = (await connection.client.listTools()).tools.map(tool => tool.name)
    assert.ok(names.includes("sap.capability.invoke_read"))
    assert.ok(!names.includes("sap.capability.invoke_write"))
    assert.ok(!names.includes("sap.capability.invoke_destructive"))

    const result = await connection.client.callTool({
      name: "sap.capability.search",
      arguments: { name: "sap.source.patch" }
    }) as CallToolResult
    assert.equal(result.isError, undefined)
    assert.deepEqual(textEnvelope(result).data?.tools, [])
  } finally {
    await connection.close()
  }
})

test("adaptive developer sessions keep ordinary destructive tools and hide admin tools", async () => {
  const connection = await connectedServer({
    apiVersion: "v1",
    role: "developer",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const names = (await connection.client.listTools()).tools.map(tool => tool.name)
    assert.ok(names.includes("sap.capability.invoke_destructive"))

    const allowed = await connection.client.callTool({
      name: "sap.capability.search",
      arguments: { name: "sap.source.patch" }
    }) as CallToolResult
    assert.deepEqual(
      (textEnvelope(allowed).data?.tools as CapabilitySummary[])
        .map(tool => ({ name: tool.name, risk: tool.risk })),
      [{ name: "sap.source.patch", risk: "destructive" }]
    )

    const hidden = await connection.client.callTool({
      name: "sap.capability.search",
      arguments: { name: "sap.git.push" }
    }) as CallToolResult
    assert.deepEqual(textEnvelope(hidden).data?.tools, [])
  } finally {
    await connection.close()
  }
})

test("adaptive artifact calls publish evidence through the outer Resource registry", async () => {
  const connection = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const capability = await describe(
      connection.client,
      "sap.artifact.mermaid.detect"
    )
    const result = await connection.client.callTool({
      name: "sap.capability.invoke_read",
      arguments: {
        name: "sap.artifact.mermaid.detect",
        schemaHash: capability.schemaHash,
        arguments: { code: "flowchart TD\nA-->B" }
      }
    }) as CallToolResult
    assert.equal(result.isError, undefined)
    const link = result.content.find(content => content.type === "resource_link")
    assert.equal(link?.type, "resource_link")
    if (link?.type !== "resource_link") throw new Error("expected resource link")

    const resource = await connection.client.readResource({ uri: link.uri })
    assert.ok(resource.contents.length > 0)
  } finally {
    await connection.close()
  }
})

function memorySink(): AuditSink & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    name: "stderr",
    events,
    write: event => { events.push(event) },
    close: async () => undefined
  }
}

test("adaptive invocation audits the underlying capability name exactly once", async () => {
  const sink = memorySink()
  const recorder = new AuditRecorder({
    sink,
    apiVersion: "v1",
    principal: { id: "tester", source: "local-process" }
  })
  const connection = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    auditRecorder: recorder,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const capability = await describe(connection.client, "sap.system.list")
    sink.events.length = 0
    await connection.client.callTool({
      name: "sap.capability.invoke_read",
      arguments: {
        name: "sap.system.list",
        schemaHash: capability.schemaHash,
        arguments: {}
      }
    })

    assert.equal(sink.events.length, 1)
    assert.equal(sink.events[0]?.name, "sap.system.list")
    assert.equal(sink.events[0]?.mutation, false)
  } finally {
    await connection.close()
    await recorder.close()
  }
})

test("adaptive audit extracts the underlying write arguments", async () => {
  const sink = memorySink()
  const recorder = new AuditRecorder({
    sink,
    apiVersion: "v1",
    principal: { id: "tester", source: "local-process" }
  })
  const connection = await connectedServer({
    apiVersion: "v1",
    adaptive: true,
    auditRecorder: recorder,
    enabledV1Tools: new Set(V1_MCP_PRESETS.adaptive),
    enabledV1Resources: new Set(V1_PRESET_RESOURCE_NAMES.adaptive)
  })
  try {
    const capability = await describe(connection.client, "sap.source.patch")
    sink.events.length = 0
    await connection.client.callTool({
      name: "sap.capability.invoke_destructive",
      arguments: {
        name: "sap.source.patch",
        schemaHash: capability.schemaHash,
        arguments: {
          systemId: "DEV100",
          fileUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
          oldString: "old",
          newString: "new"
        }
      }
    })

    assert.equal(sink.events.length, 1)
    assert.equal(sink.events[0]?.name, "sap.source.patch")
    assert.equal(sink.events[0]?.mutation, true)
    assert.equal(sink.events[0]?.destructive, true)
    assert.equal(sink.events[0]?.systemId, "DEV100")
    assert.equal(
      sink.events[0]?.target?.objectUri,
      "/sap/bc/adt/oo/classes/zcl_demo/source/main"
    )
  } finally {
    await connection.close()
    await recorder.close()
  }
})
