import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer, type McpServerOptions } from "../src/mcp-server.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import { V1_PRESET_NAMES } from "../src/mcp/v1/presets.js"
import { v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import { V1_WORKFLOW_PROMPTS } from "../src/mcp/v1/workflow-prompts.js"
import { AbapToolService } from "../src/tool-service.js"

async function connect(options: McpServerOptions = {}) {
  const service = new AbapToolService({
    async listConnections() { throw new Error("Prompt retrieval must not access SAP") },
    async getClient() { throw new Error("Prompt retrieval must not access SAP") }
  })
  const server = createMcpServer(service, options)
  const client = new Client({ name: "workflow-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, close: async () => { await client.close(); await server.close() } }
}

test("v1 exposes four bounded workflow prompts without accessing SAP or adding tools", async t => {
  const { client, close } = await connect()
  t.after(close)
  assert.ok(client.getServerCapabilities()?.prompts)
  const prompts = (await client.listPrompts()).prompts
  assert.deepEqual(prompts.map(prompt => prompt.name).sort(), V1_WORKFLOW_PROMPTS.map(prompt => prompt.name).sort())
  assert.deepEqual(
    (await client.listTools()).tools.map(tool => tool.name).sort(),
    [...v1ToolsForToolsets(["all"])].sort()
  )
  for (const prompt of prompts) {
    assert.deepEqual(prompt.arguments?.filter(arg => arg.required).map(arg => arg.name), ["systemId", "target"])
    const result = await client.getPrompt({
      name: prompt.name,
      arguments: { systemId: "DEV100", target: "ZCL_DEMO", goal: "오류 경로를 검토해 주세요" }
    })
    assert.equal(result.messages.length, 1)
    const content = result.messages[0]!.content
    assert.equal(content.type, "text")
    if (content.type !== "text") throw new Error("Expected text prompt")
    assert.match(content.text, /오류 경로를 검토해 주세요/)
    assert.match(content.text, /grants no additional permission/)
    assert.ok(Buffer.byteLength(content.text) < 8000)
  }
})

for (const preset of [...V1_PRESET_NAMES.filter(name => name !== "adaptive" && name !== "minimal" && name !== "single"), undefined]) {
  for (const role of ["viewer", "developer", "admin"] as const) {
    test(`${preset ?? "full"}/${role} prompts reference only available tools`, async t => {
      const { client, close } = await connect({ ...resolveServeToolSelection("v1", undefined, preset), role })
      t.after(close)
      const tools = new Set((await client.listTools()).tools.map(tool => tool.name))
      const expected = V1_WORKFLOW_PROMPTS.filter(prompt => prompt.tools.every(tool => tools.has(tool)))
      const prompts = (await client.listPrompts()).prompts
      assert.deepEqual(prompts.map(prompt => prompt.name), expected.map(prompt => prompt.name))
      for (const prompt of prompts) {
        const result = await client.getPrompt({ name: prompt.name, arguments: { systemId: "DEV100", target: "Z_DEMO" } })
        const content = result.messages[0]!.content
        if (content.type !== "text") throw new Error("Expected text prompt")
        const mentioned = content.text.match(/sap\.[a-z_]+(?:\.[a-z_]+)+/g) ?? []
        for (const tool of mentioned) assert.ok(tools.has(tool), `Unavailable tool: ${tool}`)
      }
    })
  }
}

test("viewer cannot retrieve the source change workflow even by guessing its name", async t => {
  const { client, close } = await connect({ role: "viewer" })
  t.after(close)
  await assert.rejects(client.getPrompt({ name: "sap-change-object", arguments: { systemId: "DEV100", target: "Z_DEMO" } }), /not found/i)
})

test("workflow arguments reject blank, missing and oversized values", async t => {
  const { client, close } = await connect()
  t.after(close)
  for (const args of [
    { systemId: "DEV100" },
    { systemId: " ", target: "Z_DEMO" },
    { systemId: "DEV100", target: " " },
    { systemId: "DEV100", target: "Z_DEMO", goal: "x".repeat(4001) }
  ]) {
    await assert.rejects(client.getPrompt({ name: "sap-explain-object", arguments: args }))
  }
})

test("v0 and empty tool selections do not advertise unusable workflow prompts", async t => {
  for (const options of [{ apiVersion: "v0" as const }, { enabledV1Tools: new Set<string>() }]) {
    const { client, close } = await connect(options)
    t.after(close)
    assert.equal(client.getServerCapabilities()?.prompts, undefined)
  }
})
