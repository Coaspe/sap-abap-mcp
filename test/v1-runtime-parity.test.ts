import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../src/mcp-server.js"
import { V1_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import {
  V1_RESOURCE_NAMES,
  v1ResourcesForToolsets,
  v1ToolsForToolsets
} from "../src/mcp/v1/toolsets.js"
import { AbapToolService } from "../src/tool-service.js"

function sorted(values: Iterable<string>): string[] {
  return [...values].sort()
}

test("the complete v1 catalog is implemented by runtime Tools and Resources", async () => {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("not used during discovery") }
  })
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["all"]),
    enabledV1Resources: v1ResourcesForToolsets(["all"])
  })
  const client = new Client({ name: "v1-runtime-parity", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  try {
    const tools = (await client.listTools()).tools
    assert.deepEqual(sorted(tools.map(tool => tool.name)), sorted(V1_TOOL_NAMES))
    assert.equal(tools.length, 113)
    for (const tool of tools) {
      assert.ok(tool.inputSchema, `${tool.name} inputSchema`)
      assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
      assert.deepEqual(Object.keys(tool.annotations ?? {}).sort(), [
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
        "readOnlyHint"
      ])
    }

    const [fixed, templates] = await Promise.all([
      client.listResources(),
      client.listResourceTemplates()
    ])
    const resourceNames = [
      ...fixed.resources.map(resource => resource.name),
      ...templates.resourceTemplates.map(resource => resource.name)
    ]
    assert.deepEqual(sorted(resourceNames), sorted(V1_RESOURCE_NAMES))
  } finally {
    await client.close()
    await server.close()
  }
})
