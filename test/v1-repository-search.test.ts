import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import {
  ABAP_OBJECT_TYPES,
  createMcpServer
} from "../src/mcp-server.js"
import {
  V1_READ_ONLY_ANNOTATIONS
} from "../src/mcp/v1/register.js"
import type { V1ReadService } from "../src/mcp/v1/service.js"
import { V1_MCP_TOOLSETS } from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

function unused<T>(name: string): T {
  return (async () => {
    throw new Error(`${name} was not expected`)
  }) as T
}

function createRepositoryService() {
  const calls: Parameters<V1ReadService["searchObjects"]>[0][] = []
  const service: V1ReadService = {
    getConnectedSystems: unused<V1ReadService["getConnectedSystems"]>("getConnectedSystems"),
    getSapSystemInfo: unused<V1ReadService["getSapSystemInfo"]>("getSapSystemInfo"),
    getSapCapabilities: unused<V1ReadService["getSapCapabilities"]>("getSapCapabilities"),
    async searchObjects(input) {
      calls.push(input)
      return {
        connectionId: input.connectionId.toUpperCase(),
        pattern: input.pattern,
        count: 2,
        objects: [{
          name: "ZCL_GREETING",
          type: "CLAS",
          uri: "/sap/bc/adt/oo/classes/zcl_greeting",
          description: "Greeting service",
          packageName: "ZDEMO"
        }, {
          name: "ZREPORT",
          type: "PROG",
          uri: "/sap/bc/adt/programs/programs/zreport/source/main"
        }]
      }
    },
    getObjectLines: unused<V1ReadService["getObjectLines"]>("getObjectLines"),
    getObjectByUri: unused<V1ReadService["getObjectByUri"]>("getObjectByUri")
  }
  return { service, calls }
}

async function connectedClient(service: V1ReadService) {
  const server = createMcpServer(service as AbapToolService, { apiVersion: "v1" })
  const client = new Client({ name: "v1-repository-test", version: "1.0.0" })
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

test("v1 repository search advertises the exact tool contract", async () => {
  const tools = await advertisedTools({ apiVersion: "v1" })
  assert.deepEqual(
    tools.map(tool => tool.name).sort(),
    [...V1_MCP_TOOLSETS.core].sort()
  )

  const tool = tools.find(candidate => candidate.name === "sap.repository.search")
  assert.ok(tool)
  assert.equal(tool.title, "Search SAP Repository")
  assert.equal(
    tool.description,
    "Search ABAP repository objects by name pattern and object type."
  )
  assert.deepEqual(tool.annotations, V1_READ_ONLY_ANNOTATIONS)
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), [
    "systemId",
    "pattern",
    "objectTypes",
    "limit"
  ])
  assert.deepEqual(tool.inputSchema.required, [
    "systemId",
    "pattern",
    "objectTypes"
  ])
  const objectTypes = tool.inputSchema.properties?.objectTypes as {
    items?: { enum?: string[] }
  }
  assert.deepEqual(objectTypes.items?.enum, [...ABAP_OBJECT_TYPES])
  assert.equal(
    (tool.inputSchema.properties?.limit as { default?: number }).default,
    20
  )

  const output = tool.outputSchema as {
    properties?: Record<string, {
      required?: string[]
      properties?: Record<string, unknown>
    }>
  }
  const data = output.properties?.data
  assert.deepEqual(data?.required, ["pattern", "objects"])
  assert.deepEqual(Object.keys(data?.properties ?? {}), ["pattern", "objects"])
  const objects = data?.properties?.objects as {
    items?: { required?: string[]; properties?: Record<string, unknown> }
  }
  assert.deepEqual(objects.items?.required, ["name", "type", "resourceUri"])
  assert.deepEqual(Object.keys(objects.items?.properties ?? {}), [
    "name",
    "type",
    "description",
    "packageName",
    "resourceUri"
  ])
})

test("v1 repository search reuses one shared service call and returns canonical resources", async t => {
  const { service, calls } = createRepositoryService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const result = await connection.client.callTool({
    name: "sap.repository.search",
    arguments: {
      systemId: " dev100 ",
      pattern: "Z*",
      objectTypes: ["CLAS", "PROG"],
      limit: 7
    }
  }) as CallToolResult

  assert.deepEqual(calls, [{
    connectionId: "DEV100",
    pattern: "Z*",
    types: ["CLAS", "PROG"],
    maxResults: 7
  }])
  assert.deepEqual(result.structuredContent, JSON.parse(textContent(result)))
  assert.equal(result.structuredContent?.systemId, "DEV100")
  assert.deepEqual(result.structuredContent?.page, { returned: 2 })
  assert.equal("total" in (result.structuredContent?.page as object), false)
  assert.equal("nextCursor" in (result.structuredContent?.page as object), false)

  const data = result.structuredContent?.data as {
    pattern: string
    objects: Array<Record<string, unknown>>
  }
  assert.equal(data.pattern, "Z*")
  assert.deepEqual(data.objects, [{
    name: "ZCL_GREETING",
    type: "CLAS",
    description: "Greeting service",
    packageName: "ZDEMO",
    resourceUri: "adt://dev100/sap/bc/adt/oo/classes/zcl_greeting"
  }, {
    name: "ZREPORT",
    type: "PROG",
    resourceUri: "adt://dev100/sap/bc/adt/programs/programs/zreport/source/main"
  }])
  assert.ok(data.objects.every(object => !("uri" in object)))
  assert.ok(data.objects.every(object => !("connectionId" in object)))
})
