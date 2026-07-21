import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer, type McpServerOptions } from "../src/mcp-server.js"
import { V1_READ_ONLY_ANNOTATIONS } from "../src/mcp/v1/register.js"
import type { V1ReadService } from "../src/mcp/v1/service.js"
import { V1_MCP_TOOLSETS } from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

const CAPABILITY_CATEGORIES = [
  "connection",
  "repository",
  "execution",
  "semantic",
  "quality",
  "debugging",
  "insight"
]

function unused<T>(name: string): T {
  return (async () => {
    throw new Error(`${name} was not expected`)
  }) as T
}

function createCapabilityService() {
  const calls: Array<{
    systemId: string
    category: string | undefined
    includeEvidence: boolean | undefined
  }> = []
  const service: V1ReadService = {
    getConnectedSystems: unused<V1ReadService["getConnectedSystems"]>("getConnectedSystems"),
    getSapSystemInfo: unused<V1ReadService["getSapSystemInfo"]>("getSapSystemInfo"),
    async getSapCapabilities(systemId, category, includeEvidence) {
      calls.push({ systemId, category, includeEvidence })
      const capability = {
        id: "repository.activate.batch",
        category: "repository" as const,
        implementation: "implemented" as const,
        system: "advertised" as const,
        authorization: "allowed" as const,
        status: "supported" as const,
        lastObservedAt: "2026-07-20T00:00:00.000Z",
        ...(includeEvidence
          ? { evidence: ["discovery:/sap/bc/adt/activation"] }
          : {})
      }
      return {
        connectionId: systemId.trim().toUpperCase(),
        adapterVersion: "abap-adt-api@8.4.1",
        systemMetadata: {
          environment: "development" as const,
          sapRelease: "758",
          systemType: "S/4HANA" as const,
          logicalSystem: "DEVCLNT100",
          discoveryCollections: 12,
          warnings: ["The discovery document was incomplete"]
        },
        capabilities: [capability]
      }
    },
    searchObjects: unused<V1ReadService["searchObjects"]>("searchObjects"),
    getObjectLines: unused<V1ReadService["getObjectLines"]>("getObjectLines"),
    getObjectByUri: unused<V1ReadService["getObjectByUri"]>("getObjectByUri")
  }
  return { service, calls }
}

async function connectedClient(
  service: V1ReadService,
  options: McpServerOptions
) {
  const server = createMcpServer(service as AbapToolService, options)
  const client = new Client({ name: "v1-capability-test", version: "1.0.0" })
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

function textContent(result: CallToolResult): string {
  const content = result.content.find(item => item.type === "text")
  assert.equal(content?.type, "text")
  if (content?.type !== "text") throw new Error("expected text content")
  return content.text
}

test("v1 capability discovery advertises the exact tool contract", async () => {
  const tools = await advertisedTools({ apiVersion: "v1" })
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...V1_MCP_TOOLSETS.core].sort())

  const tool = tools.find(candidate => candidate.name === "sap.system.capabilities")
  assert.ok(tool)
  assert.equal(tool.title, "Inspect SAP Capabilities")
  assert.equal(
    tool.description,
    "Read implemented, advertised, authorized, and observed capabilities for one SAP system."
  )
  assert.deepEqual(tool.annotations, V1_READ_ONLY_ANNOTATIONS)
  assert.deepEqual(tool.inputSchema.required, ["systemId"])
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), [
    "systemId",
    "category",
    "includeEvidence"
  ])
  assert.deepEqual(
    (tool.inputSchema.properties?.category as { enum?: string[] }).enum,
    CAPABILITY_CATEGORIES
  )
  assert.equal(
    (tool.inputSchema.properties?.includeEvidence as { default?: boolean }).default,
    false
  )

  const output = tool.outputSchema as {
    required?: string[]
    properties?: Record<string, {
      required?: string[]
      properties?: Record<string, unknown>
      items?: {
        required?: string[]
        properties?: Record<string, { enum?: string[] }>
      }
    }>
  }
  assert.deepEqual([...(output.required ?? [])].sort(), [
    "schemaVersion",
    "requestId",
    "status",
    "data",
    "warnings"
  ].sort())
  assert.deepEqual(Object.keys(output.properties ?? {}), [
    "schemaVersion",
    "requestId",
    "status",
    "systemId",
    "warnings",
    "evidence",
    "page",
    "data"
  ])
  const data = output.properties?.data
  assert.deepEqual(data?.required, [
    "adapterVersion",
    "resourceUri",
    "systemMetadata",
    "capabilities"
  ])
  assert.deepEqual(Object.keys(data?.properties ?? {}), [
    "adapterVersion",
    "resourceUri",
    "systemMetadata",
    "capabilities"
  ])
  const capability = data?.properties?.capabilities as {
    items?: { required?: string[]; properties?: Record<string, { enum?: string[] }> }
  }
  assert.deepEqual(capability.items?.required, [
    "id",
    "category",
    "implementation",
    "system",
    "authorization",
    "status",
    "lastObservedAt"
  ])
  assert.deepEqual(Object.keys(capability.items?.properties ?? {}), [
    "id",
    "category",
    "implementation",
    "system",
    "authorization",
    "status",
    "evidence",
    "lastObservedAt"
  ])
  assert.deepEqual(capability.items?.properties?.category?.enum, CAPABILITY_CATEGORIES)
})

test("v1 capability calls normalize identity, warnings, evidence, and resource links", async t => {
  const { service, calls } = createCapabilityService()
  const connection = await connectedClient(service, { apiVersion: "v1" })
  t.after(() => connection.close())

  const compact = await connection.client.callTool({
    name: "sap.system.capabilities",
    arguments: {
      systemId: " dev100 ",
      category: "repository",
      includeEvidence: false
    }
  }) as CallToolResult
  assert.deepEqual(compact.structuredContent, JSON.parse(textContent(compact)))
  assert.equal(compact.structuredContent?.systemId, "DEV100")
  assert.equal(compact.structuredContent?.status, "partial")
  assert.deepEqual(compact.structuredContent?.warnings, [{
    code: "SAP_SYSTEM_WARNING",
    message: "The discovery document was incomplete"
  }])
  const compactData = compact.structuredContent?.data as Record<string, unknown>
  assert.equal("connectionId" in compactData, false)
  assert.equal(compactData.resourceUri, "sap-capability://dev100")
  assert.equal(
    "warnings" in (compactData.systemMetadata as Record<string, unknown>),
    false
  )
  const compactCapabilities = compactData.capabilities as Array<Record<string, unknown>>
  assert.equal("evidence" in compactCapabilities[0]!, false)
  assert.deepEqual(calls[0], {
    systemId: "DEV100",
    category: "repository",
    includeEvidence: false
  })

  const detailed = await connection.client.callTool({
    name: "sap.system.capabilities",
    arguments: { systemId: "DEV100", includeEvidence: true }
  }) as CallToolResult
  assert.deepEqual(detailed.structuredContent, JSON.parse(textContent(detailed)))
  const detailedCapabilities = (
    detailed.structuredContent?.data as { capabilities: Array<{ evidence?: string[] }> }
  ).capabilities
  assert.deepEqual(detailedCapabilities[0]?.evidence, [
    "discovery:/sap/bc/adt/activation"
  ])
  assert.ok(detailedCapabilities[0]!.evidence!.every(item =>
    Buffer.byteLength(item, "utf8") <= 512
  ))
  assert.deepEqual(calls[1], {
    systemId: "DEV100",
    category: undefined,
    includeEvidence: true
  })

  const resourceLinks = detailed.content.filter(item => item.type === "resource_link")
  assert.deepEqual(resourceLinks, [{
    type: "resource_link",
    uri: "sap-capability://dev100",
    name: "SAP Capability Evidence for DEV100",
    description: "Read complete SAP capability discovery evidence for DEV100.",
    mimeType: "application/json"
  }])
})

test("v1 capability resource template reads complete evidence from the shared service", async t => {
  const { service, calls } = createCapabilityService()
  const connection = await connectedClient(service, { apiVersion: "v1" })
  t.after(() => connection.close())

  const templates = await connection.client.listResourceTemplates()
  assert.deepEqual(templates.resourceTemplates.find(template =>
    template.uriTemplate === "sap-capability://{system}"
  ), {
    name: "sap-capability-evidence",
    title: "SAP Capability Evidence",
    description: "Complete capability discovery evidence for one SAP system.",
    uriTemplate: "sap-capability://{system}",
    mimeType: "application/json"
  })

  const resource = await connection.client.readResource({
    uri: "sap-capability://dev100"
  })
  assert.deepEqual(calls, [{
    systemId: "DEV100",
    category: undefined,
    includeEvidence: true
  }])
  assert.equal(resource.contents.length, 1)
  const content = resource.contents[0]
  assert.ok(content && "text" in content)
  if (!content || !("text" in content)) throw new Error("expected text resource")
  assert.deepEqual({ uri: content.uri, mimeType: content.mimeType }, {
    uri: "sap-capability://dev100",
    mimeType: "application/json"
  })
  assert.deepEqual(JSON.parse(content.text), {
    adapterVersion: "abap-adt-api@8.4.1",
    systemMetadata: {
      environment: "development",
      sapRelease: "758",
      systemType: "S/4HANA",
      logicalSystem: "DEVCLNT100",
      discoveryCollections: 12,
      warnings: ["The discovery document was incomplete"]
    },
    capabilities: [{
      id: "repository.activate.batch",
      category: "repository",
      implementation: "implemented",
      system: "advertised",
      authorization: "allowed",
      status: "supported",
      lastObservedAt: "2026-07-20T00:00:00.000Z",
      evidence: ["discovery:/sap/bc/adt/activation"]
    }]
  })
})

test("capability resources are absent from v0 mode and present in all mode", async t => {
  const { service } = createCapabilityService()
  const v0 = await connectedClient(service, { apiVersion: "v0" })
  const all = await connectedClient(service, { apiVersion: "all" })
  t.after(async () => {
    await v0.close()
    await all.close()
  })

  assert.equal(v0.client.getServerCapabilities()?.resources, undefined)
  const templates = (await all.client.listResourceTemplates())
    .resourceTemplates.map(item => item.uriTemplate)
  assert.ok(templates.includes("sap-capability://{system}"))
  assert.ok(templates.includes("adt://{system}/{+adtPath}"))
})
