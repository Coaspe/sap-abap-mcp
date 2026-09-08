import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const bytes = value => Buffer.byteLength(JSON.stringify(value))
async function run(lineWidth, batched) {
  const sources = new Map(Array.from({ length: 5 }, (_, i) => [`ZOBJ${i}`, Array.from({ length: 100 }, (_, line) =>
    `" ${i}:${line} ${"x".repeat(lineWidth)}`).join("\n")]))
  let reads = 0
  const sap = {
    async searchObjects(name) { return [{ name, type: "PROG/P", uri: `/sap/bc/adt/programs/programs/${name.toLowerCase()}` }] },
    async readObject(object) { reads++; return { object, source: sources.get(object.name), sourceUri: `${object.uri}/source/main` } }
  }
  const service = new AbapToolService({ async getClient() { return sap }, async listConnections() { return [] } })
  const server = createMcpServer(service, { adaptive: true })
  const client = new Client({ name: "batch-cost-benchmark", version: "1.0.0" })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const stages = []
  const collected = new Map([...sources.keys()].map(name => [name, []]))
  try {
    await server.connect(st)
    await client.connect(ct)
    const tools = (await client.listTools()).tools
    async function call(name, args) {
      const request = { name, arguments: args }
      const result = await client.callTool(request)
      assert.notEqual(result.isError, true)
      assert.ok(["succeeded", "partial"].includes(result.structuredContent?.status))
      stages.push({ tool: name, requestBytes: bytes(request), responseBytes: bytes(result), status: result.structuredContent.status })
      return result.structuredContent.data
    }
    if (batched) {
      const name = "sap.source.read_batch"
      // The workflow already knows the capability name; no redundant search is needed.
      const described = await call("sap.capability.describe", { name })
      let requests = [...sources.keys()].map(objectName => ({ objectName, startLine: 1, lineCount: 100 }))
      let rounds = 0
      while (requests.length) {
        assert.ok(++rounds <= 10, "Continuation must make progress")
        const result = await call("sap.capability.invoke_read", { name, schemaHash: described.capability.schemaHash,
          arguments: { systemId: "DEV100", requests } })
        assert.ok(result.returnedSourceBytes <= 65536)
        assert.equal(result.returnedSourceBytes, result.results.reduce((sum, item) => sum + (item.ok ? Buffer.byteLength(item.result.code) : 0), 0))
        const next = []
        for (const item of result.results) {
          if (item.deferred) { next.push(item.request); continue }
          assert.equal(item.ok, true)
          if (item.result.code) collected.get(item.request.objectName).push(item.result.code)
          if (item.result.truncated) {
            assert.ok(Number.isInteger(item.result.nextLine) && item.result.nextLine >= item.request.startLine)
            next.push({ objectName: item.request.objectName, startLine: item.result.nextLine,
              lineCount: item.request.startLine + item.request.lineCount - item.result.nextLine })
          }
        }
        requests = next
      }
    } else {
      for (const objectName of sources.keys()) {
        const result = await call("sap.source.read", { systemId: "DEV100", objectName, startLine: 1, lineCount: 100 })
        assert.equal(result.truncated, false)
        collected.get(objectName).push(result.code)
      }
    }
    for (const [name, source] of sources) assert.equal(collected.get(name).join("\n"), source, `Exact source restoration for ${name}`)
    const requestBytes = stages.reduce((sum, stage) => sum + stage.requestBytes, 0)
    const responseBytes = stages.reduce((sum, stage) => sum + stage.responseBytes, 0)
    return { scenario: lineWidth === 20 ? "fits-one-batch" : "requires-continuation", batched,
      schemaBytes: bytes(tools), toolCalls: stages.length, sourceAdapterReads: reads,
      requestBytes, responseBytes, payloadBytes: requestBytes + responseBytes,
      peakResponseBytes: Math.max(...stages.map(stage => stage.responseBytes)), stages }
  } finally { await client.close(); await server.close(); service.dispose() }
}
const runs = []
for (const width of [20, 400]) for (const batched of [false, true]) runs.push(await run(width, batched))
process.stdout.write(`${JSON.stringify({ schemaVersion: "1.0", liveSapCalls: 0, modelCalls: 0,
  measurement: "minified UTF-8 MCP payloads, adaptive server, synthetic SAP source; all continuation calls included",
  exclusions: ["model tokenization and replay", "JSON-RPC framing", "SAP HTTP requests and latency"], runs }, null, 2)}\n`)
