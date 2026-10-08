import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { resolveServeToolSelection } from "../dist/src/mcp/tool-selection.js"
import { AbapToolService } from "../dist/src/tool-service.js"

const cli = process.argv.slice(2)
const withTokens = cli[0] === "--tokens"
if (withTokens) cli.shift()
const baseline = cli[0] === "--baseline"
if (baseline) cli.shift()
const [flag, output, ...extra] = cli
if (flag !== undefined && (flag !== "--output" || !output || extra.length)) {
  throw new Error("Usage: node scripts/benchmark-conditional-batch.mjs [--tokens] [--baseline] [--output path]")
}
const encoder = withTokens ? (await import("js-tiktoken")).getEncoding("o200k_base") : undefined
const json = value => JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  "00000000-0000-0000-0000-000000000000")
const measure = value => ({ bytes: Buffer.byteLength(json(value)), ...(encoder ? { tokens: encoder.encode(json(value), [], []).length } : {}) })

async function run(mode, strategy, unchangedReads) {
  const sources = new Map(Array.from({ length: 5 }, (_, i) => [`ZOBJ${i}`, Array.from({ length: 100 }, (_, line) =>
    `  WRITE 'Review object ${i}, line ${line}: ${"x".repeat(40)}'.`).join("\n")]))
  let reads = 0
  const sap = {
    async searchObjects(name) { return [{ name, type: "PROG/P", uri: `/sap/bc/adt/programs/programs/${name.toLowerCase()}` }] },
    async readObject(object) { reads++; return { object, source: sources.get(object.name), sourceUri: `${object.uri}/source/main` } }
  }
  const service = new AbapToolService({ async getClient() { return sap } })
  const server = createMcpServer(service, mode === "full" ? {} : resolveServeToolSelection("v1", undefined, mode))
  const client = new Client({ name: "conditional-batch-benchmark", version: "1.0.0" })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const stages = []
  const retained = new Map()
  const validators = new Map()
  let tools
  let instructions
  let schemaHash
  const batched = strategy.startsWith("batch")
  const conditional = strategy.endsWith("conditional")
  const name = batched ? "sap.source.read_batch" : "sap.source.read"
  async function raw(stage, request) {
    const result = await client.callTool(request)
    assert.notEqual(result.isError, true, `${stage} ${name}`)
    assert.equal(result.structuredContent?.status, "succeeded", `${stage} must be complete`)
    stages.push({ stage, request: measure(request), response: measure(result) })
    return result.structuredContent.data
  }
  async function call(stage, args) {
    return raw(stage, schemaHash ? { name: mode === "single" ? "sap" : "sap.capability.invoke_read",
      arguments: { name, schemaHash, arguments: args, ...(mode === "single" ? { risk: "read" } : {}) } }
      : { name, arguments: args })
  }
  function consume(objectName, result) {
    if (result.notModified) {
      assert.equal(conditional, true)
      assert.equal("code" in result, false)
      assert.equal(result.contentHash, validators.get(objectName))
    } else {
      assert.equal(typeof result.code, "string")
      retained.set(objectName, result.code)
    }
    if (result.contentHash) validators.set(objectName, result.contentHash)
    assert.equal(result.truncated, false)
    assert.equal(retained.get(objectName), sources.get(objectName), `Exact current source for ${objectName}`)
  }
  async function round(stage) {
    const requests = [...sources.keys()].map(objectName => ({ objectName, startLine: 1, lineCount: 100,
      ...(conditional && validators.has(objectName) ? { ifNoneMatch: validators.get(objectName) } : {}) }))
    if (batched) {
      const data = await call(stage, { systemId: "DEV100", requests })
      assert.equal(data.results.length, sources.size)
      assert.ok(data.returnedSourceBytes <= 65536)
      assert.equal(data.returnedSourceBytes, data.results.reduce((sum, item) => sum + Buffer.byteLength(item.result.code ?? ""), 0))
      for (const item of data.results) {
        assert.equal(item.ok, true)
        consume(item.request.objectName, item.result)
      }
    } else {
      for (const request of requests) consume(request.objectName, await call(stage, { systemId: "DEV100", ...request }))
    }
  }
  try {
    await server.connect(st)
    await client.connect(ct)
    tools = (await client.listTools()).tools
    instructions = { instructions: client.getInstructions() ?? "" }
    if (!tools.some(tool => tool.name === name)) {
      const args = { name }
      const described = await raw("describe", mode === "single"
        ? { name: "sap", arguments: { name: "describe", arguments: args } }
        : { name: "sap.capability.describe", arguments: args })
      schemaHash = described.capability.schemaHash
    }
    await round("first")
    for (let i = 0; i < unchangedReads; i++) await round("unchanged")
    sources.set("ZOBJ2", sources.get("ZOBJ2").replace("line 0:", "line 0 edited:"))
    await round("changed")
    assert.equal(reads, sources.size * (unchangedReads + 2), "Every object is freshly read in every round")
    const schema = measure(tools)
    const initialization = measure(instructions)
    const requestBytes = stages.reduce((sum, stage) => sum + stage.request.bytes, 0)
    const responseBytes = stages.reduce((sum, stage) => sum + stage.response.bytes, 0)
    return { mode, strategy, unchangedReads, toolCount: tools.length, schema, initialization,
      clientToolCalls: stages.length, sourceAdapterReads: reads, requestBytes, responseBytes,
      totalWithInstructionsBytes: schema.bytes + initialization.bytes + requestBytes + responseBytes,
      ...(encoder ? { totalWithInstructionsTokens: schema.tokens + initialization.tokens +
        stages.reduce((sum, stage) => sum + stage.request.tokens + stage.response.tokens, 0) } : {}), stages }
  } finally { await client.close(); await server.close(); service.dispose() }
}

const runs = []
for (const mode of ["full", "adaptive", "minimal", "single"]) {
  for (const unchangedReads of [0, 1, 20]) {
    for (const strategy of ["individual-full", "individual-conditional", "batch-full", ...(!baseline ? ["batch-conditional"] : [])]) {
      runs.push(await run(mode, strategy, unchangedReads))
    }
  }
}
if (!baseline) {
  for (const optimized of runs.filter(run => run.strategy === "batch-conditional" && run.unchangedReads > 0)) {
    const full = runs.find(run => run.mode === optimized.mode && run.unchangedReads === optimized.unchangedReads && run.strategy === "batch-full")
    assert.equal(optimized.clientToolCalls, full.clientToolCalls)
    assert.equal(optimized.sourceAdapterReads, full.sourceAdapterReads)
    assert.ok(optimized.totalWithInstructionsBytes < full.totalWithInstructionsBytes)
    if (encoder) assert.ok(optimized.totalWithInstructionsTokens < full.totalWithInstructionsTokens)
    if (optimized.unchangedReads === 20) {
      const individual = runs.find(run => run.mode === optimized.mode && run.unchangedReads === 20 && run.strategy === "individual-conditional")
      assert.equal(optimized.sourceAdapterReads, individual.sourceAdapterReads)
      assert.ok(optimized.clientToolCalls < individual.clientToolCalls)
      assert.ok(optimized.totalWithInstructionsBytes < individual.totalWithInstructionsBytes)
      if (encoder) assert.ok(optimized.totalWithInstructionsTokens < individual.totalWithInstructionsTokens)
    }
  }
}
const report = { schemaVersion: "1.0", fixture: "five-100-line-objects-rechecks-and-one-external-edit", baseline,
  measurement: "Minified schemas counted once, initialization instructions, tool requests and complete text plus structured responses; known-name describe calls included",
  ...(encoder ? { tokenizer: "o200k_base" } : {}), liveSapCalls: 0, modelCalls: 0,
  exclusions: ["Model selection/correctness and actual billing", "Host schema caching and cumulative conversation replay", "SAP HTTP traffic and latency", "JSON-RPC framing", "Search when capability name is unknown", "Partial-source continuation (covered separately by benchmark:batch and protocol tests)"], runs }
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (output) await writeFile(output, serialized)
process.stdout.write(serialized)
