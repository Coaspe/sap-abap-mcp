import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../dist/src/mcp-server.js"
import { resolveServeToolSelection } from "../dist/src/mcp/tool-selection.js"

const cli = process.argv.slice(2)
const withTokens = cli[0] === "--tokens"
if (withTokens) cli.shift()
const knownCapabilities = cli[0] === "--known-capabilities"
if (knownCapabilities) cli.shift()
const [flag, output, ...extra] = cli
if (flag !== undefined && (flag !== "--output" || !output || extra.length)) {
  throw new Error("Usage: node scripts/benchmark-mcp-workflow.mjs [--tokens] [--known-capabilities] [--output path]")
}
const encoder = withTokens ? (await import("js-tiktoken")).getEncoding("o200k_base") : undefined
// Synthetic data only. Normalize generated UUIDs, including the textual envelope.
const json = value => JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  "00000000-0000-0000-0000-000000000000")
const bytes = value => Buffer.byteLength(json(value), "utf8")
const tokens = value => encoder?.encode(json(value), [], []).length
const original = Array.from({ length: 200 }, (_, index) =>
  `  WRITE 'Synthetic ABAP review fixture line ${index}'.`
).join("\n")
const changed = original.replace("line 0'", "line 0 edited'")
const component = { name: "RUN", type: "CLAS/OM", visibility: "public", childCount: 0 }

async function run(mode, conditional, unchangedReads) {
  let code = original
  let sourceCalls = 0
  let componentCalls = 0
  let diagnosticCalls = 0
  const service = {
    async getAbapDiagnostics(input) {
      assert.equal(input.fileUri, "/sap/bc/adt/oo/classes/zcl_demo/source/main")
      diagnosticCalls++
      return { connectionId: "DEV100", diagnostics: [], total: 0, returned: 0, truncated: false }
    },
    async inspectCode(input) {
      assert.equal(input.action, "components")
      componentCalls++
      return { connectionId: "DEV100", components: [component], total: 1, returned: 1, truncated: false }
    },
    async getObjectLines(input) {
      assert.equal(input.objectName, "ZCL_DEMO")
      assert.equal(input.startLine, 1)
      assert.equal(input.lineCount, 200)
      sourceCalls++
      return {
        connectionId: "DEV100", object: { name: "ZCL_DEMO", type: "CLAS" },
        sourceUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main",
        startLine: 1, endLine: 200, totalLines: 200, truncated: false, nextLine: null, code
      }
    }
  }
  const server = createMcpServer(service, mode === "full" ? {} : resolveServeToolSelection("v1", undefined, mode))
  const client = new Client({ name: "workflow-benchmark", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const stages = []
  let advertised = new Set()
  const hashes = new Map()
  async function raw(stage, name, args) {
    const request = { name, arguments: args }
    const result = await client.callTool(request)
    assert.notEqual(result.isError, true, `${stage} failed`)
    assert.equal(result.structuredContent?.status, "succeeded", `${stage} did not succeed`)
    stages.push({ stage, requestBytes: bytes(request), responseBytes: bytes(result),
      ...(encoder ? { requestTokens: tokens(request), responseTokens: tokens(result) } : {}) })
    return result.structuredContent.data
  }
  async function call(stage, name, args) {
    if (advertised.has(name)) return raw(stage, name, args)
    if (!hashes.has(name)) {
      if (!knownCapabilities) {
        const found = await raw(`discover-${name}`, mode === "single" ? "sap" : "sap.capability.search",
          mode === "single" ? { name: "search", arguments: { name, limit: 1 } } : { name, limit: 1 })
        assert.equal(found.tools[0].name, name)
      }
      const described = await raw(`describe-${name}`, mode === "single" ? "sap" : "sap.capability.describe",
        mode === "single" ? { name: "describe", arguments: { name } } : { name })
      hashes.set(name, described.capability.schemaHash)
    }
    return raw(stage, mode === "single" ? "sap" : "sap.capability.invoke_read", {
      name, arguments: args, schemaHash: hashes.get(name), ...(mode === "single" ? { risk: "read" } : {})
    })
  }
  try {
    const listed = await client.listTools()
    const instructions = { instructions: client.getInstructions() ?? "" }
    assert.ok(instructions.instructions.length > 0)
    assert.ok(bytes(instructions) <= 1024, "Initialization instructions must not preload a capability catalog")
    advertised = new Set(listed.tools.map(tool => tool.name))
    const schemaBytes = bytes(listed.tools)
    const args = { systemId: "DEV100", fileUri: "/sap/bc/adt/oo/classes/zcl_demo/source/main", limit: 20 }
    const structure = await call("components", "sap.semantic.components", args)
    assert.deepEqual(structure.components, [component])
    const sourceArgs = { systemId: "DEV100", objectName: "ZCL_DEMO", lineCount: 200 }
    const first = await call("source-first", "sap.source.read", sourceArgs)
    assert.equal(first.code, original)
    const repeatArgs = conditional ? { ...sourceArgs, ifNoneMatch: first.contentHash } : sourceArgs
    for (let index = 0; index < unchangedReads; index++) {
      const repeated = await call("source-unchanged", "sap.source.read", repeatArgs)
      assert.equal(repeated.notModified, conditional)
      assert.equal(repeated.code, conditional ? undefined : original)
      assert.equal(repeated.contentHash, first.contentHash)
    }
    code = changed
    const edited = await call("source-changed", "sap.source.read", repeatArgs)
    assert.equal(edited.notModified, false)
    assert.equal(edited.code, changed)
    assert.notEqual(edited.contentHash, first.contentHash)
    const diagnostics = await call("diagnose", "sap.source.diagnose", { systemId: args.systemId, fileUri: args.fileUri })
    assert.deepEqual(diagnostics.diagnostics, [])
    assert.equal(sourceCalls, unchangedReads + 2, "Every source read must still reach the service")
    assert.equal(componentCalls, 1)
    assert.equal(diagnosticCalls, 1)
    const requestBytes = stages.reduce((total, stage) => total + stage.requestBytes, 0)
    const responseBytes = stages.reduce((total, stage) => total + stage.responseBytes, 0)
    const totalTokens = encoder ? tokens(listed.tools) + stages.reduce((total, stage) => total + stage.requestTokens + stage.responseTokens, 0) : undefined
    return {
      mode, conditional, unchangedReads, toolCount: listed.tools.length,
      schemaBytes, requestBytes, responseBytes,
      totalBytes: schemaBytes + requestBytes + responseBytes,
      initializationInstructions: { bytes: bytes(instructions), ...(encoder ? { tokens: tokens(instructions) } : {}) },
      totalWithInstructionsBytes: schemaBytes + bytes(instructions) + requestBytes + responseBytes,
      ...(encoder ? { schemaTokens: tokens(listed.tools),
        totalTokens, totalWithInstructionsTokens: totalTokens + tokens(instructions) } : {}),
      clientToolCalls: stages.length, serviceCalls: { source: sourceCalls, components: componentCalls, diagnostics: diagnosticCalls }, stages
    }
  } finally {
    await client.close()
    await server.close()
  }
}

const runs = []
for (const mode of ["full", "adaptive", "minimal", "single"]) {
  for (const unchangedReads of [1, 20]) {
    for (const conditional of [false, true]) runs.push(await run(mode, conditional, unchangedReads))
    const baseline = runs.find(run => run.mode === mode && run.unchangedReads === unchangedReads && !run.conditional)
    const optimized = runs.find(run => run.mode === mode && run.unchangedReads === unchangedReads && run.conditional)
    assert.ok(optimized.totalBytes < baseline.totalBytes, `${mode}: conditional reads must reduce fixture payload`)
  }
}
const report = {
  schemaVersion: "2.1", fixture: "components-200-line-source-rechecks-and-diagnostics",
  measurement: "minified UTF-8 tool schemas plus tool request parameters and complete tool results",
  discovery: knownCapabilities ? "known-name-describe" : "search-and-describe",
  instructionsMeasurement: "Separate minified initialization instructions field, included only in totalWithInstructions fields",
  ...(encoder ? { tokenizer: "o200k_base" } : {}),
  liveSapCalls: 0, modelCalls: 0,
  exclusions: ["JSON-RPC framing and other initialization fields", "host-native tool search and schema caching", "model billing and cumulative conversation replay", "SAP network traffic and latency", "write approval interactions", "prompt/resource lists and prompt bodies (not requested in this workflow)"],
  runs
}
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (output) await writeFile(output, serialized)
process.stdout.write(serialized)
