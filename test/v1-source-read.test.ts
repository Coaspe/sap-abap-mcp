import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer } from "../src/mcp-server.js"
import {
  V1_IMPLEMENTED_TOOL_NAMES
} from "../src/mcp/v1/migration-catalog.js"
import { V1_READ_ONLY_ANNOTATIONS } from "../src/mcp/v1/register.js"
import type { V1ReadService } from "../src/mcp/v1/service.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

function unused<T>(name: string): T {
  return (async () => {
    throw new Error(`${name} was not expected`)
  }) as T
}

function createSourceService() {
  const lineCalls: Parameters<V1ReadService["getObjectLines"]>[0][] = []
  const uriCalls: Parameters<V1ReadService["getObjectByUri"]>[0][] = []
  const service: V1ReadService = {
    getConnectedSystems: unused<V1ReadService["getConnectedSystems"]>("getConnectedSystems"),
    getSapSystemInfo: unused<V1ReadService["getSapSystemInfo"]>("getSapSystemInfo"),
    getSapCapabilities: unused<V1ReadService["getSapCapabilities"]>("getSapCapabilities"),
    searchObjects: unused<V1ReadService["searchObjects"]>("searchObjects"),
    async getObjectLines(input) {
      lineCalls.push(input)
      if (input.methodName) {
        return {
          connectionId: input.connectionId.toUpperCase(),
          object: { name: input.objectName, type: input.objectType ?? "CLAS" },
          sourceUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
          methodName: input.methodName,
          startLine: 10,
          endLine: 12,
          methodEndLine: 12,
          truncated: false,
          nextLine: null,
          code: "METHOD greet.\n  RETURN.\nENDMETHOD."
        }
      }
      return {
        connectionId: input.connectionId.toUpperCase(),
        object: { name: input.objectName, type: input.objectType ?? "CLAS" },
        sourceUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
        startLine: input.startLine,
        endLine: input.startLine + 1,
        totalLines: 120,
        truncated: true,
        nextLine: input.startLine + 2,
        code: "CLASS zcl_demo DEFINITION.\nENDCLASS."
      }
    },
    async getObjectByUri(input) {
      uriCalls.push(input)
      return {
        connectionId: input.connectionId.toUpperCase(),
        requestedUri: input.uri,
        sourceUri: input.uri,
        startLine: input.startLine,
        endLine: 3,
        totalLines: 3,
        truncated: false,
        nextLine: null,
        code: "CLASS zcl_demo IMPLEMENTATION.\n  METHOD greet.\n  ENDMETHOD."
      }
    }
  }
  return { service, lineCalls, uriCalls }
}

async function connectedClient(service: V1ReadService) {
  const server = createMcpServer(service as AbapToolService, { apiVersion: "v1" })
  const client = new Client({ name: "v1-source-test", version: "1.0.0" })
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

test("v1 source read advertises the exact implemented tool contract", async () => {
  const v1Tools = await advertisedTools({ apiVersion: "v1" })
  assert.deepEqual(
    v1Tools.map(tool => tool.name).sort(),
    [...V1_IMPLEMENTED_TOOL_NAMES].sort()
  )

  const allTools = await advertisedTools({ apiVersion: "all" })
  assert.equal(allTools.length, 58)
  assert.equal(new Set(allTools.map(tool => tool.name)).size, 58)

  const tool = v1Tools.find(candidate => candidate.name === "sap.source.read")
  assert.ok(tool)
  assert.equal(tool.title, "Read ABAP Source")
  assert.equal(
    tool.description,
    "Read a bounded active ABAP source range or one class method."
  )
  assert.deepEqual(tool.annotations, V1_READ_ONLY_ANNOTATIONS)
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), [
    "systemId",
    "objectName",
    "objectType",
    "methodName",
    "startLine",
    "lineCount"
  ])
  assert.deepEqual(tool.inputSchema.required, ["systemId", "objectName"])
  assert.equal(
    (tool.inputSchema.properties?.startLine as { default?: number }).default,
    1
  )
  assert.equal(
    (tool.inputSchema.properties?.lineCount as { default?: number }).default,
    50
  )
  assert.ok(tool.outputSchema)
  const data = (tool.outputSchema as {
    properties?: Record<string, {
      required?: string[]
      properties?: Record<string, unknown>
    }>
  }).properties?.data
  assert.deepEqual(data?.required, [
    "object",
    "resourceUri",
    "startLine",
    "endLine",
    "truncated",
    "nextLine",
    "code"
  ])
  assert.deepEqual(Object.keys(data?.properties ?? {}), [
    "object",
    "resourceUri",
    "methodName",
    "startLine",
    "endLine",
    "methodEndLine",
    "totalLines",
    "truncated",
    "nextLine",
    "code"
  ])
})

test("v1 source read makes one shared service call and maps full object source", async t => {
  const { service, lineCalls, uriCalls } = createSourceService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const result = await connection.client.callTool({
    name: "sap.source.read",
    arguments: {
      systemId: " dev100 ",
      objectName: "ZCL_DEMO",
      objectType: "CLAS",
      startLine: 4,
      lineCount: 2
    }
  }) as CallToolResult

  assert.deepEqual(lineCalls, [{
    connectionId: "DEV100",
    objectName: "ZCL_DEMO",
    objectType: "CLAS",
    startLine: 4,
    lineCount: 2
  }])
  assert.deepEqual(uriCalls, [])
  assert.deepEqual(result.structuredContent, JSON.parse(textContent(result)))
  assert.equal(result.structuredContent?.systemId, "DEV100")
  assert.equal("page" in (result.structuredContent ?? {}), false)
  const data = result.structuredContent?.data as Record<string, unknown>
  assert.equal(data.resourceUri, "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main")
  assert.equal("sourceUri" in data, false)
  assert.equal("connectionId" in data, false)
  assert.deepEqual(data, {
    object: { name: "ZCL_DEMO", type: "CLAS" },
    resourceUri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main",
    startLine: 4,
    endLine: 5,
    totalLines: 120,
    truncated: true,
    nextLine: 6,
    code: "CLASS zcl_demo DEFINITION.\nENDCLASS."
  })
  assert.deepEqual(result.content.slice(1), [{
    type: "resource_link",
    uri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main",
    name: "ABAP Source ZCL_DEMO",
    description: "Read active ABAP source for ZCL_DEMO.",
    mimeType: "text/x-abap"
  }])
})

test("v1 source read preserves the method contract without extra SAP calls", async t => {
  const { service, lineCalls, uriCalls } = createSourceService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const result = await connection.client.callTool({
    name: "sap.source.read",
    arguments: {
      systemId: "DEV100",
      objectName: "ZCL_DEMO",
      methodName: "GREET"
    }
  }) as CallToolResult

  assert.deepEqual(lineCalls, [{
    connectionId: "DEV100",
    objectName: "ZCL_DEMO",
    methodName: "GREET",
    startLine: 1,
    lineCount: 50
  }])
  assert.deepEqual(uriCalls, [])
  assert.deepEqual(result.structuredContent, JSON.parse(textContent(result)))
  const data = result.structuredContent?.data as Record<string, unknown>
  assert.deepEqual(data, {
    object: { name: "ZCL_DEMO", type: "CLAS" },
    resourceUri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main",
    methodName: "GREET",
    startLine: 10,
    endLine: 12,
    methodEndLine: 12,
    truncated: false,
    nextLine: null,
    code: "METHOD greet.\n  RETURN.\nENDMETHOD."
  })
})

test("v1 ADT source resource reads one complete canonical source", async t => {
  const { service, lineCalls, uriCalls } = createSourceService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const templates = await connection.client.listResourceTemplates()
  assert.deepEqual(
    templates.resourceTemplates.map(template => template.uriTemplate).sort(),
    ["adt://{system}/{+adtPath}", "sap-capability://{system}"]
  )

  const resource = await connection.client.readResource({
    uri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main"
  })

  assert.deepEqual(lineCalls, [])
  assert.deepEqual(uriCalls, [{
    connectionId: "DEV100",
    uri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
    startLine: 0,
    lineCount: Number.MAX_SAFE_INTEGER
  }])
  assert.equal(resource.contents.length, 1)
  const content = resource.contents[0]
  assert.ok(content && "text" in content)
  if (!content || !("text" in content)) throw new Error("expected text resource")
  assert.deepEqual({
    uri: content.uri,
    mimeType: content.mimeType,
    text: content.text,
    _meta: content._meta
  }, {
    uri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main",
    mimeType: "text/x-abap",
    text: "CLASS zcl_demo IMPLEMENTATION.\n  METHOD greet.\n  ENDMETHOD.",
    _meta: {
      startLine: 0,
      endLine: 3,
      totalLines: 3,
      truncated: false,
      nextLine: null
    }
  })
})

test("v1 ADT source resource preserves encoded path segment boundaries", async t => {
  const { service, uriCalls } = createSourceService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const resource = await connection.client.readResource({
    uri: "adt://DEV100/sap/bc/adt/oo/classes/zcl_demo%2Fpart/source/main"
  })

  assert.deepEqual(uriCalls, [{
    connectionId: "DEV100",
    uri: "/sap/bc/adt/oo/classes/zcl_demo%2Fpart/source/main",
    startLine: 0,
    lineCount: Number.MAX_SAFE_INTEGER
  }])
  assert.equal(
    resource.contents[0]?.uri,
    "adt://dev100/sap/bc/adt/oo/classes/zcl_demo%2Fpart/source/main"
  )
})
