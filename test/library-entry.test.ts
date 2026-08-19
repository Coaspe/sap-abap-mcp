import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  AbapToolService,
  createEmbeddedMcpServer,
  createMcpServer
} from "../src/library.js"

test("the public library entry creates a transport-neutral embeddable MCP server", async t => {
  const runtime = createEmbeddedMcpServer({
    connectionProvider: {
      async listConnections() { return [] },
      async getClient() { throw new Error("No SAP call expected") }
    },
    serverOptions: { apiVersion: "v1" }
  })
  assert.ok(runtime.service instanceof AbapToolService)
  assert.equal(typeof createMcpServer, "function")

  const client = new Client({ name: "embedded-library-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await runtime.close()
  })
  await runtime.server.connect(serverTransport)
  await client.connect(clientTransport)

  const listed = await client.listTools()
  assert.equal(listed.tools.length, 115)
  assert.ok(listed.tools.some(tool => tool.name === "sap.repository.search"))
})
