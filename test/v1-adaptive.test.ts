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
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
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

test("single gateway discovers and invokes exact schemas while enforcing risk and schema hashes", async () => {
  const connection = await connectedServer({ apiVersion: "v1", ...resolveServeToolSelection("v1", undefined, "single") })
  try {
    const tools = (await connection.client.listTools()).tools
    assert.deepEqual(tools.map(tool => tool.name), ["sap"])
    assert.equal(tools[0]?.annotations?.destructiveHint, true)
    const call = async (args: Record<string, unknown>) => connection.client.callTool({ name: "sap", arguments: args }) as Promise<CallToolResult>
    const found = textEnvelope(await call({ name: "search", arguments: { name: "sap.system.list" } }))
    assert.equal((found.data?.tools as CapabilitySummary[])[0]?.name, "sap.system.list")
    const described = textEnvelope(await call({ name: "describe", arguments: { name: "sap.system.list" } }))
    const capability = described.data?.capability as { schemaHash: string; risk: string }
    assert.equal(resultCode(await call({ name: "sap.system.list" })), "CAPABILITY_ARGUMENTS_REQUIRED")
    assert.equal(resultCode(await call({ name: "sap.system.list", risk: "read", schemaHash: "0".repeat(64) })), "CAPABILITY_SCHEMA_CHANGED")
    assert.equal(resultCode(await call({ name: "sap.system.list", risk: "write", schemaHash: capability.schemaHash })), "CAPABILITY_RISK_MISMATCH")
    assert.equal((await call({ name: "sap.system.list", risk: capability.risk, schemaHash: capability.schemaHash })).isError, undefined)
    const prompt = await connection.client.getPrompt({ name: "sap-explain-object", arguments: { systemId: "DEV100", target: "ZCL_TEST" } })
    assert.match(JSON.stringify(prompt), /Call sap with name=describe/)
    assert.doesNotMatch(JSON.stringify(prompt), /sap\.capability\.describe/)
  } finally { await connection.close() }
})

test("single viewer gateway remains read-only and cannot discover or invoke mutation tools", async () => {
  const connection = await connectedServer({ apiVersion: "v1", role: "viewer", ...resolveServeToolSelection("v1", undefined, "single") })
  try {
    const tools = (await connection.client.listTools()).tools
    assert.equal(tools.length, 1)
    assert.equal(tools[0]?.annotations?.readOnlyHint, true)
    const result = await connection.client.callTool({ name: "sap", arguments: { name: "sap.source.patch", risk: "destructive", schemaHash: "0".repeat(64) } }) as CallToolResult
    assert.equal(resultCode(result), "CAPABILITY_NOT_FOUND")
  } finally { await connection.close() }
})

test("single discovery errors provide a recoverable schema without reflecting supplied secrets", async () => {
  const connection = await connectedServer({ apiVersion: "v1", ...resolveServeToolSelection("v1", undefined, "single") })
  try {
    for (const [name, args] of [["search", { limit: 500, secret: "sensitive-fixture" }], ["describe", { name: 42, secret: "sensitive-fixture" }]] as const) {
      const failed = await connection.client.callTool({ name: "sap", arguments: { name, arguments: args } }) as CallToolResult
      const envelope = JSON.parse(firstText(failed))
      assert.equal(envelope.code, "CAPABILITY_ARGUMENTS_INVALID")
      assert.equal(envelope.category, "validation")
      assert.equal(envelope.retryable, false)
      assert.equal(envelope.details.inputSchema.type, "object")
      assert.equal(envelope.details.inputSchema.additionalProperties, false)
      if (name === "search") {
        assert.equal(envelope.details.inputSchema.properties.limit.maximum, 50)
        assert.equal(envelope.details.inputSchema.properties.limit.default, 10)
      } else {
        assert.deepEqual(envelope.details.inputSchema.required, ["name"])
      }
      assert.doesNotMatch(firstText(failed), /sensitive-fixture|"secret"/)
    }
    const corrected = await connection.client.callTool({ name: "sap", arguments: { name: "search", arguments: { name: "sap.system.list", limit: 1 } } }) as CallToolResult
    assert.equal(corrected.isError, undefined)
    assert.equal((textEnvelope(corrected).data?.tools as CapabilitySummary[])[0]?.name, "sap.system.list")
  } finally { await connection.close() }
})

test("single gateway audits the resolved capability risk without increasing wire metadata", async () => {
  const sink = memorySink()
  const recorder = new AuditRecorder({ sink, apiVersion: "v1", principal: { id: "tester", source: "local-process" } })
  const connection = await connectedServer({ apiVersion: "v1", auditRecorder: recorder, ...resolveServeToolSelection("v1", undefined, "single") })
  try {
    const description = await connection.client.callTool({ name: "sap", arguments: { name: "describe", arguments: { name: "sap.system.list" } } }) as CallToolResult
    assert.equal(sink.events.at(-1)?.mutation, false)
    const capability = textEnvelope(description).data?.capability as { schemaHash: string }
    sink.events.length = 0
    const result = await connection.client.callTool({ name: "sap", arguments: { name: "sap.system.list", risk: "read", schemaHash: capability.schemaHash } })
    assert.equal(sink.events.length, 1)
    assert.equal(sink.events[0]?.name, "sap.system.list")
    assert.equal(sink.events[0]?.mutation, false)
    assert.equal(sink.events[0]?.destructive, false)
    assert.doesNotMatch(JSON.stringify(result), /resolved-tool-risk/)
  } finally { await connection.close(); await recorder.close() }
})

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

for (const role of ["viewer", "developer", "admin"] as const) {
  test(`adaptive ${role} workflows use deferred capabilities without losing guidance`, async () => {
    const connection = await connectedServer({ adaptive: true, role })
    try {
      const prompts = (await connection.client.listPrompts()).prompts
      assert.equal(prompts.length, role === "viewer" ? 3 : 4)
      assert.equal(prompts.some(prompt => prompt.name === "sap-change-object"), role !== "viewer")
      for (const prompt of prompts) {
        const result = await connection.client.getPrompt({
          name: prompt.name,
          arguments: { systemId: "DEV100", target: "Z_DEMO" }
        })
        const content = result.messages[0]!.content
        assert.equal(content.type, "text")
        if (content.type === "text") {
          assert.match(content.text, /sap.capability.describe/)
          assert.match(content.text, /schemaHash/)
        }
      }
    } finally {
      await connection.close()
    }
  })
}

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


test("adaptive finds deferred parameter features without exposing their schemas in search", async () => {
  const connection = await connectedServer({ apiVersion: "v1", adaptive: true })
  try {
    for (const query of ["includeRelated", "KTD"]) {
      const result = await connection.client.callTool({ name: "sap.capability.search",
        arguments: { query, category: "semantic", risk: "read", limit: 5 } }) as CallToolResult
      const data = textEnvelope(result).data as { tools: Array<{ name: string; inputSchema?: unknown }> }
      assert.ok(data.tools.some(tool => tool.name === "sap.semantic.components"), query)
      assert.ok(data.tools.every(tool => tool.inputSchema === undefined))
    }
    const exact = await connection.client.callTool({ name: "sap.capability.search",
      arguments: { query: "sap.semantic.components", limit: 1 } }) as CallToolResult
    assert.equal((textEnvelope(exact).data as any).tools[0].name, "sap.semantic.components")
    const filtered = await connection.client.callTool({ name: "sap.capability.search",
      arguments: { query: "includeRelated", risk: "write", limit: 5 } }) as CallToolResult
    assert.equal((textEnvelope(filtered).data as any).tools.length, 0)
  } finally { await connection.close() }
})


test("capability search discovers declared enum choices without exposing input schemas", async () => {
  for (const preset of ["adaptive", "single"] as const) {
    const connection = await connectedServer({ apiVersion: "v1", ...resolveServeToolSelection("v1", undefined, preset) })
    try {
      for (const [query, expected] of [["jumpToLine", "sap.debug.step"], ["sarif", "sap.transport.assess"], ["upsert", "sap.classic.write"]]) {
        const args = { query, limit: 5 }
        const result = await connection.client.callTool(preset === "single"
          ? { name: "sap", arguments: { name: "search", arguments: args } }
          : { name: "sap.capability.search", arguments: args }) as CallToolResult
        const tools = textEnvelope(result).data?.tools as Array<CapabilitySummary & { inputSchema?: unknown }>
        assert.ok(tools.some(tool => tool.name === expected), `${preset}: ${query}`)
        assert.ok(tools.every(tool => tool.inputSchema === undefined))
      }
    } finally { await connection.close() }
  }
  const viewer = await connectedServer({ apiVersion: "v1", adaptive: true, role: "viewer" })
  try {
    const result = await viewer.client.callTool({ name: "sap.capability.search", arguments: { query: "jumpToLine" } }) as CallToolResult
    assert.deepEqual(textEnvelope(result).data?.tools, [])
  } finally { await viewer.close() }
})

test("specific task words outrank generic check matches without expanding the search schema", async () => {
  const connection = await connectedServer({ apiVersion: "v1", adaptive: true })
  try {
    for (const query of ["syntax check", "check syntax"]) {
      const result = await connection.client.callTool({ name: "sap.capability.search", arguments: { query, limit: 3 } }) as CallToolResult
      const tools = textEnvelope(result).data?.tools as Array<CapabilitySummary & { score: number }>
      assert.ok(tools.some(tool => tool.name === "sap.source.diagnose"), query)
      assert.ok(tools.every(tool => Number.isInteger(tool.score)))
    }
  } finally { await connection.close() }
})

test("exact capability queries return one result without weakening filters or fuzzy discovery", async () => {
  for (const singleTool of [false, true]) {
    const connection = await connectedServer({ apiVersion: "v1",
      ...(singleTool ? resolveServeToolSelection("v1", undefined, "single") : { adaptive: true }) })
    try {
      const search = async (args: Record<string, unknown>) => {
        const result = await connection.client.callTool(singleTool
          ? { name: "sap", arguments: { name: "search", arguments: args } }
          : { name: "sap.capability.search", arguments: args }) as CallToolResult
        return textEnvelope(result).data as { tools: CapabilitySummary[]; nextCursor?: string }
      }
      const exact = await search({ query: " SAP.SEMANTIC.COMPONENTS " })
      assert.deepEqual(exact.tools.map(tool => tool.name), ["sap.semantic.components"])
      assert.equal(exact.nextCursor, undefined)
      assert.deepEqual((await search({ query: "sap.semantic.components", risk: "write" })).tools, [])
      assert.deepEqual((await search({ query: "sap.semantic.components", category: "source" })).tools, [])
      assert.deepEqual((await search({ query: "sap.semantic.components", name: "sap.system.list" })).tools, [])
      assert.ok((await search({ query: "semantic" })).tools.length > 1)
      assert.ok((await search({ query: "includeRelated" })).tools.some(tool => tool.name === "sap.semantic.components"))
    } finally { await connection.close() }
  }
})

test("minimal preset exposes only gateways and can discover and invoke system listing", async () => {
  const connection = await connectedServer({ apiVersion: "v1", ...resolveServeToolSelection("v1", undefined, "minimal") })
  try {
    assert.deepEqual((await connection.client.listTools()).tools.map(tool => tool.name).sort(), [...ADAPTIVE_V1_TOOL_NAMES].sort())
    assert.equal((await connection.client.listPrompts()).prompts.length, 4)
    const capability = await describe(connection.client, "sap.system.list")
    const result = await connection.client.callTool({ name: "sap.capability.invoke_read", arguments: {
      name: "sap.system.list", schemaHash: capability.schemaHash, arguments: {}
    } }) as CallToolResult
    assert.equal(result.isError, undefined)
    assert.equal((textEnvelope(result).data as any).systems[0].id, "DEV100")
  } finally { await connection.close() }
})
