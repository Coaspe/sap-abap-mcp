import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer, type McpServerOptions } from "../../src/mcp-server.js"
import { AbapToolService } from "../../src/tool-service.js"

export async function advertisedTools(options?: McpServerOptions): Promise<Tool[]> {
  const service = new AbapToolService({
    async listConnections() { return [] },
    async getClient() { throw new Error("not used while listing tools") }
  })
  const server = createMcpServer(service, options)
  const client = new Client({ name: "mcp-surface", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
    await server.close()
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    )
  }
  return value
}

export function stableToolSurface(tools: Tool[]): Array<{
  name: string
  title?: string
  description?: string
  inputSchema: Tool["inputSchema"]
  annotations?: Tool["annotations"]
}> {
  return [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(tool => ({
      name: tool.name,
      ...(tool.title === undefined ? {} : { title: tool.title }),
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: stableValue(tool.inputSchema) as Tool["inputSchema"],
      ...(tool.annotations === undefined
        ? {}
        : { annotations: stableValue(tool.annotations) as Tool["annotations"] })
    }))
}
