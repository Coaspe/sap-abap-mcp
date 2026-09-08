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
const [flag, output, ...extra] = cli
if (flag !== undefined && (flag !== "--output" || !output || extra.length)) {
  throw new Error("Usage: node scripts/benchmark-public-contracts.mjs [--tokens] [--output path]")
}
// Optional development dependency; published runtime benchmarks still work without it.
const encoder = withTokens ? (await import("js-tiktoken")).getEncoding("o200k_base") : undefined
const tokens = value => encoder?.encode(JSON.stringify(value), [], []).length

const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8")
const rootUri = "/sap/bc/adt/oo/classes/zcl_demo"
const fixtures = new Map([[rootUri, {
  name: "ZCL_DEMO", type: "CLAS/OC", source: `CLASS zcl_demo DEFINITION PUBLIC INHERITING FROM zcl_base.
PUBLIC SECTION.
INTERFACES: zif_first, zif_second.
METHODS run.
ENDCLASS.`
}]])
for (const name of ["zcl_base", "zif_first", "zif_second"]) {
  const isClass = name.startsWith("zcl")
  fixtures.set(`/sap/bc/adt/oo/${isClass ? "classes" : "interfaces"}/${name}`, {
    name: name.toUpperCase(), type: isClass ? "CLAS/OC" : "INTF/OI",
    source: `${isClass ? `CLASS ${name} DEFINITION PUBLIC.\nPUBLIC SECTION.` : `INTERFACE ${name} PUBLIC.`}
"! Synthetic contract for ${name}.
METHODS execute IMPORTING value TYPE string RETURNING VALUE(result) TYPE i.
${isClass ? "PRIVATE SECTION.\nDATA private_secret TYPE string.\nENDCLASS." : "ENDINTERFACE."}`
  })
}
const objectUri = uri => uri.replace(/\/source\/main(?:#.*)?$/, "")

async function run(adaptive, integrated, withDocumentation, gatewayOnly = false, single = false) {
  const calls = { source: 0, structure: 0, search: 0, definition: 0, documentation: 0 }
  const sap = {
    async readSourceByUri(uri) {
      calls.source++
      const key = objectUri(uri)
      assert.ok(fixtures.has(key), `Unexpected source ${uri}`)
      return { source: fixtures.get(key).source, sourceUri: `${key}/source/main` }
    },
    async readObject(object) {
      return { ...await this.readSourceByUri(object.uri), object }
    },
    async getKnowledgeTransferDocument(name) {
      calls.documentation++
      assert.equal(name, "ZCL_DEMO")
      return { uri: "/sap/bc/adt/documentation/ktd/documents/zcl_demo",
        markdown: "# Synthetic design\n\n한🙂글: Delegate execution through three public contracts.\n".repeat(12) }
    },
    async getObjectStructure(uri) {
      calls.structure++
      const fixture = fixtures.get(uri)
      assert.ok(fixture, `Unexpected structure ${uri}`)
      return { metaData: { "adtcore:name": fixture.name, "adtcore:type": fixture.type } }
    },
    async searchObjects(name, type) {
      calls.search++
      return [...fixtures].filter(([, item]) => item.name === name && (!type || item.type === type))
        .map(([uri, item]) => ({ name: item.name, type: item.type, uri, packageName: "$TMP" }))
    },
    async findDefinition(uri, source, line, start, end) {
      calls.definition++
      assert.equal(uri, `${rootUri}/source/main`)
      const name = source.split("\n")[line - 1].slice(start, end).toUpperCase()
      const target = [...fixtures].find(([, item]) => item.name === name)
      assert.ok(target, `Unexpected symbol ${name}`)
      return { url: `${target[0]}/source/main`, line: 1, column: 0 }
    }
  }
  const service = new AbapToolService({ async listConnections() { return [] }, async getClient() { return sap } })
  const server = createMcpServer(service, { adaptive, ...(gatewayOnly ? resolveServeToolSelection("v1", undefined, single ? "single" : "minimal") : {}) })
  const client = new Client({ name: "public-contract-benchmark", version: "1.0.0" })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const stages = []
  const hashes = new Map()
  let advertised = new Set()
  async function raw(stage, name, args) {
    const request = { name, arguments: args }
    const result = await client.callTool(request)
    assert.notEqual(result.isError, true, JSON.stringify(result))
    assert.equal(result.structuredContent?.status, "succeeded")
    stages.push({ stage, requestBytes: bytes(request), responseBytes: bytes(result),
      ...(encoder ? { requestTokens: tokens(request), responseTokens: tokens(result) } : {}) })
    return result.structuredContent.data
  }
  async function call(name, args) {
    if (!adaptive || advertised.has(name)) return raw(name, name, args)
    if (!hashes.has(name)) {
      const found = await raw("discover", single ? "sap" : "sap.capability.search", single ? { name: "search", arguments: { name, limit: 1 } } : { name, limit: 1 })
      assert.equal(found.tools[0].name, name)
      const description = await raw("describe", single ? "sap" : "sap.capability.describe", single ? { name: "describe", arguments: { name } } : { name })
      hashes.set(name, description.capability.schemaHash)
    }
    return raw(name, single ? "sap" : "sap.capability.invoke_read", { name, schemaHash: hashes.get(name), arguments: args, ...(single ? { risk: "read" } : {}) })
  }
  try {
    await server.connect(st)
    await client.connect(ct)
    const listed = await client.listTools()
    advertised = new Set(listed.tools.map(tool => tool.name))
    const documentationArgs = withDocumentation ? { documentation: { offset: 0, maxChars: 2000 } } : {}
    const root = await call("sap.semantic.components", { systemId: "DEV100", fileUri: `${rootUri}/source/main`,
      publicApi: true, ...(integrated ? { includeRelated: true, ...documentationArgs } : {}), limit: 20 })
    const contracts = []
    if (integrated) {
      assert.equal(root.relatedCoverage.truncated, false)
      assert.equal(root.relatedCoverage.attempted, 3)
      for (const item of root.relatedContracts) {
        assert.equal(item.status, "included")
        assert.equal(item.codeTruncated, false)
        contracts.push({ uri: item.sourceUri, hash: item.sourceHash, code: item.code })
      }
    } else {
      for (const ref of root.declarations.flatMap(item => item.relatedTypes ?? [])) {
        const found = await call("sap.semantic.definition", { systemId: "DEV100", fileUri: root.sourceUri,
          line: ref.line, column: ref.column, endColumn: ref.column + ref.name.length })
        const contract = await call("sap.semantic.components", { systemId: "DEV100", fileUri: found.definition.uri,
          publicApi: true, limit: 20 })
        assert.equal(contract.truncated, false)
        contracts.push({ uri: contract.sourceUri, hash: contract.sourceHash, code: contract.declarations.map(item => item.code).join("\n") })
      }
    }
    let documentation
    if (withDocumentation) {
      const result = integrated ? root : await call("sap.repository.inspect", {
        systemId: "DEV100", objectName: "ZCL_DEMO", objectType: "CLAS/OC", ...documentationArgs })
      const { objectName: _owner, ...page } = result.documentation
      assert.equal(page.status, "available")
      assert.equal(page.truncated, false)
      assert.equal(page.nextOffset, null)
      documentation = page
      assert.equal(calls.documentation, 1)
    }
    assert.equal(contracts.length, 3)
    assert.doesNotMatch(JSON.stringify(contracts), /private_secret/)
    const requestBytes = stages.reduce((sum, item) => sum + item.requestBytes, 0)
    const responseBytes = stages.reduce((sum, item) => sum + item.responseBytes, 0)
    const tokenCounts = encoder ? {
      schema: tokens(listed.tools),
      requests: stages.reduce((sum, item) => sum + item.requestTokens, 0),
      responses: stages.reduce((sum, item) => sum + item.responseTokens, 0)
    } : undefined
    if (tokenCounts) tokenCounts.total = tokenCounts.schema + tokenCounts.requests + tokenCounts.responses
    const sapAdapterCalls = { ...calls }
    let unchangedRepeat
    if (integrated) {
      const repeat = await call("sap.semantic.components", { systemId: "DEV100", fileUri: `${rootUri}/source/main`,
        publicApi: true, includeRelated: true, ...documentationArgs, limit: 20, ifNoneMatch: root.contentHash })
      assert.equal(repeat.notModified, true)
      assert.equal(repeat.contentHash, root.contentHash)
      assert.equal(repeat.declarations, undefined)
      assert.equal(repeat.relatedContracts, undefined)
      assert.equal(repeat.documentation, undefined)
      const repeatedStage = stages.pop()
      assert.ok(repeatedStage.responseBytes < stages.at(-1).responseBytes)
      const repeatedCalls = Object.fromEntries(Object.entries(calls).map(([name, count]) => [name, count - sapAdapterCalls[name]]))
      assert.deepEqual(repeatedCalls, sapAdapterCalls, "Conditional response must recheck all SAP inputs")
      unchangedRepeat = { requestBytes: repeatedStage.requestBytes, responseBytes: repeatedStage.responseBytes,
        sapAdapterCalls: repeatedCalls,
        ...(encoder ? { requestTokens: repeatedStage.requestTokens, responseTokens: repeatedStage.responseTokens } : {}) }
    }
    return { mode: single ? "single" : gatewayOnly ? "gateway-only" : adaptive ? "adaptive" : "full", integrated, withDocumentation, documentation, schemaBytes: bytes(listed.tools),
      requestBytes, responseBytes, totalBytes: bytes(listed.tools) + requestBytes + responseBytes,
      clientToolCalls: stages.length, ...(tokenCounts ? { tokenCounts } : {}), sapAdapterCalls, stages, ...(unchangedRepeat ? { unchangedRepeat } : {}),
      contracts: contracts.sort((a, b) => a.uri.localeCompare(b.uri)) }
  } finally { await client.close(); await server.close(); service.dispose() }
}

const runs = []
for (const withDocumentation of [false, true]) for (const mode of ["full", "adaptive", "gateway-only", "single"]) {
  const adaptive = mode !== "full"
  const manual = await run(adaptive, false, withDocumentation, mode === "gateway-only" || mode === "single", mode === "single")
  const integrated = await run(adaptive, true, withDocumentation, mode === "gateway-only" || mode === "single", mode === "single")
  assert.deepEqual(integrated.documentation, manual.documentation, "Optimization must retain the complete KTD page and hash")
  assert.deepEqual(integrated.contracts, manual.contracts, "Optimization must retain contract code and source hashes")
  assert.ok(integrated.clientToolCalls < manual.clientToolCalls)
  assert.ok(integrated.totalBytes < manual.totalBytes)
  if (encoder) assert.ok(integrated.tokenCounts.total < manual.tokenCounts.total)
  assert.equal(integrated.sapAdapterCalls.definition, manual.sapAdapterCalls.definition)
  runs.push(manual, integrated)
}
const report = { schemaVersion: "1.2",
  ...(encoder ? { tokenizer: { package: "js-tiktoken", encoding: "o200k_base", scope: "separately encoded minified JSON payloads; not billed model usage" } } : {}), fixture: "three-explicit-public-contracts", liveSapCalls: 0, modelCalls: 0,
  measurement: "minified UTF-8 schema arrays, MCP request parameters and complete results; real AbapToolService with synthetic SAP adapter",
  exclusions: ["JSON-RPC framing and initialization", "model message framing, billed usage and conversation replay", "SAP HTTP requests and latency", "host-native deferred discovery"],
  runs: runs.map(({ contracts: _contracts, documentation: _documentation, ...run }) => run) }
const json = `${JSON.stringify(report, null, 2)}\n`
if (output) await writeFile(output, json)
process.stdout.write(json)
