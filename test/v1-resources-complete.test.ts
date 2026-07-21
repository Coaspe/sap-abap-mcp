import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AppError } from "../src/errors.js"
import { V1EvidenceStore } from "../src/mcp/v1/evidence-store.js"
import {
  V1_RESOURCE_NAMES,
  v1ResourcesForToolsets
} from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"

interface RecordedCall { method: string; input: unknown }

function createResourceService() {
  const calls: RecordedCall[] = []
  const service = {
    getAbapSqlSyntax() {
      calls.push({ method: "getAbapSqlSyntax", input: {} })
      return { dialect: "SAP ADT data preview SQL", rules: ["SELECT only"] }
    },
    getAbapFsDocumentation(input: unknown) {
      calls.push({ method: "getAbapFsDocumentation", input })
      return { source: "bundled", content: "compatibility documentation" }
    },
    getMermaidDocumentation(diagramType: string, includeExamples: boolean) {
      calls.push({ method: "getMermaidDocumentation", input: { diagramType, includeExamples } })
      return { diagramType, documentation: {} }
    },
    async manageTransportRequests(input: unknown) {
      calls.push({ method: "manageTransportRequests", input })
      return { connectionId: "DEV100", transportNumber: "DEVK900001", objects: [] }
    }
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: new Set(),
    enabledV1Resources: v1ResourcesForToolsets(["all"])
  })
  const client = new Client({ name: "v1-resources-complete", version: "1.0.0" })
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

function resourceText(content: Awaited<ReturnType<Client["readResource"]>>["contents"][number]) {
  assert.ok("text" in content)
  if (!("text" in content)) throw new Error("expected text resource")
  return content.text
}

test("all seven v1 Resources are discoverable without service calls", async t => {
  const { service, calls } = createResourceService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const [fixed, templates] = await Promise.all([
    connection.client.listResources(),
    connection.client.listResourceTemplates()
  ])
  const names = [
    ...fixed.resources.map(resource => resource.name),
    ...templates.resourceTemplates.map(resource => resource.name)
  ]
  assert.deepEqual(names.sort(), [...V1_RESOURCE_NAMES].sort())
  assert.deepEqual(
    templates.resourceTemplates.map(resource => resource.uriTemplate).sort(),
    [
      "adt://{system}/{+adtPath}",
      "sap-capability://{system}",
      "sap-docs://compat/{document}",
      "sap-docs://mermaid/{document}",
      "sap-evidence://{runId}/{artifact}",
      "sap-transport://{system}/{transport}"
    ].sort()
  )
  assert.deepEqual(fixed.resources.map(resource => resource.uri), ["sap-docs://data-query"])
  assert.deepEqual(calls, [])
})

test("documentation and transport Resources call only their shared providers", async t => {
  const { service, calls } = createResourceService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const sql = await connection.client.readResource({ uri: "sap-docs://data-query" })
  const compat = await connection.client.readResource({ uri: "sap-docs://compat/documentation" })
  const mermaid = await connection.client.readResource({ uri: "sap-docs://mermaid/flowchart" })
  const transport = await connection.client.readResource({
    uri: "sap-transport://DEV100/devk900001"
  })

  assert.equal(JSON.parse(resourceText(sql.contents[0]!)).dialect, "SAP ADT data preview SQL")
  assert.equal(resourceText(compat.contents[0]!), "compatibility documentation")
  assert.equal(JSON.parse(resourceText(mermaid.contents[0]!)).diagramType, "flowchart")
  assert.equal(transport.contents[0]?.uri, "sap-transport://dev100/DEVK900001")
  assert.deepEqual(calls.map(call => call.method), [
    "getAbapSqlSyntax",
    "getAbapFsDocumentation",
    "getMermaidDocumentation",
    "manageTransportRequests"
  ])
  assert.deepEqual(calls[3]?.input, {
    action: "get_transport_details",
    connectionId: "DEV100",
    transportNumber: "DEVK900001",
    startIndex: 0,
    maxResults: 500,
    includeObjects: true
  })
})

test("session evidence is redacted, bounded, and isolated by server run", () => {
  const first = new V1EvidenceStore()
  const second = new V1EvidenceStore()
  const uri = first.put("report", {
    authorization: "Bearer artifact-secret",
    nested: { client_secret: "nested-secret" }
  })
  const evidence = first.read(uri)
  assert.equal(evidence.text.includes("artifact-secret"), false)
  assert.equal(evidence.text.includes("nested-secret"), false)
  assert.ok(Buffer.byteLength(evidence.text, "utf8") <= 256 * 1024)
  assert.throws(
    () => second.read(uri),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_ADT_URI"
  )
})
