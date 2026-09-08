import assert from "node:assert/strict"
import test from "node:test"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../src/mcp-server.js"
import type { AbapToolService } from "../src/tool-service.js"

const exec = promisify(execFile)
test("live read preflight reports missing configuration without SAP calls or false success", async t => {
  const home = await mkdtemp(join(tmpdir(), "sap-live-read-preflight-"))
  t.after(() => rm(home, { recursive: true, force: true }))
  const output = join(home, "evidence.json")
  await assert.rejects(exec(process.execPath, ["scripts/live-read-context.mjs",
    "--profile", "DEV100", "--object", "ZCL_DEMO", "--type", "CLAS", "--output", output], {
    env: { ...process.env, SAP_ABAP_MCP_HOME: home }
  }), (error: any) => error.code === 2)
  const report = JSON.parse(await readFile(output, "utf8"))
  assert.equal(report.status, "blocked")
  assert.equal(report.reason, "PROFILE_NOT_CONFIGURED")
  assert.equal(report.sapFacingToolCalls, 0)
  assert.equal(report.writes, 0)
  assert.deepEqual(report.stages.map((stage: any) => stage.tool), ["sap.system.list"])
})

test("live read evidence requires an explicit object and type before starting", async () => {
  await assert.rejects(exec(process.execPath, ["scripts/live-read-context.mjs", "--profile", "DEV100"]),
    (error: any) => error.code === 1 && error.stderr.includes("Required: --object"))
})

const loadContractCheck = async () => (await import(pathToFileURL(resolve("scripts/public-contract-evidence.mjs")).href)).checkPublicContracts
const contractFixture = () => ({ view: "public_api", notModified: false, contentHash: "a".repeat(64),
  documentation: { status: "available", version: "active", objectName: "PRIVATE_NAME",
    content: "SENSITIVE_KTD", documentHash: "d".repeat(64), offset: 0, returned: 13, totalChars: 13, truncated: false, nextOffset: null },
  declarations: [{ code: "SENSITIVE_ROOT_SOURCE" }], truncated: true,
  relatedContracts: [{ status: "included", code: "SENSITIVE_RELATED_SOURCE" }, { status: "unresolved", name: "PRIVATE_NAME" }],
  relatedCoverage: { attempted: 2, truncated: false } })

test("live contract evidence consumes the real source-read Resource contract", async () => {
  const uri = "/sap/bc/adt/oo/classes/%2fexample%2fcl_demo/source/main"
  let contractCalls = 0
  const server = createMcpServer({
    async getObjectLines() {
      return { connectionId: "DEV100", object: { name: "/EXAMPLE/CL_DEMO", type: "CLAS" }, sourceUri: uri,
        startLine: 1, endLine: 1, totalLines: 1, truncated: false, nextLine: null, code: "PRIVATE_SOURCE_BODY" }
    },
    async inspectCode(input: any) {
      assert.equal(input.action, "components")
      assert.equal(input.fileUri, uri)
      contractCalls++
      return input.ifNoneMatch ? { view: "public_api", notModified: true, contentHash: "a".repeat(64) } : contractFixture()
    }
  } as unknown as AbapToolService, { adaptive: true })
  const client = new Client({ name: "live-evidence-contract", version: "1" })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(st)
    await client.connect(ct)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args })
      assert.notEqual(result.isError, true, JSON.stringify(result))
      return (result.structuredContent as any).data
    }
    const source = await call("sap.source.read", { systemId: "DEV100", objectName: "/EXAMPLE/CL_DEMO", objectType: "CLAS" })
    assert.equal(source.sourceUri, undefined)
    assert.match(source.resourceUri, /^adt:\/\/dev100\//)
    const check = await loadContractCheck()
    const report = await check(call, "DEV100", source)
    assert.equal(report.revalidation, "unchanged")
    assert.equal(contractCalls, 2)
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SOURCE_BODY|SENSITIVE|PRIVATE_NAME/)
  } finally { await client.close(); await server.close() }
})

test("public contract evidence verifies deferred calls without retaining SAP source", async () => {
  const check = await loadContractCheck()
  const calls: any[] = []
  const result = await check(async (name: string, args: any, sapFacing = true) => {
    calls.push({ name, args, sapFacing })
    if (calls.length === 1) return { capability: { schemaHash: "b".repeat(64) } }
    if (calls.length === 2) return contractFixture()
    return { view: "public_api", notModified: true, contentHash: "a".repeat(64) }
  }, "DEV100", { resourceUri: "adt://dev100/sap/bc/adt/oo/classes/zcl_demo/source/main" })
  assert.equal(calls.length, 3)
  assert.equal(calls[0].sapFacing, false)
  assert.equal(calls[1].args.schemaHash, "b".repeat(64))
  assert.equal(calls[1].args.arguments.includeRelated, true)
  assert.equal(calls[2].args.arguments.ifNoneMatch, "a".repeat(64))
  assert.deepEqual(calls[1].args.arguments.documentation, { offset: 0, maxChars: 2000 })
  assert.deepEqual(result.documentation, { status: "available", returned: 13, truncated: false })
  assert.equal(result.revalidation, "unchanged")
  assert.equal(result.rootTruncated, true)
  assert.equal(result.relatedIncluded, 1)
  assert.equal(result.relatedUnresolved, 1)
  assert.doesNotMatch(JSON.stringify(result), /SENSITIVE|PRIVATE_NAME|contentHash/)
})

test("public contract evidence distinguishes concurrent changes and rejects invalid conditional results", async () => {
  const check = await loadContractCheck()
  for (const repeated of [
    { ...contractFixture(), contentHash: "c".repeat(64) },
    { ...contractFixture(), notModified: true },
    { view: "public_api", notModified: true, contentHash: "c".repeat(64) },
    contractFixture()
  ]) {
    let calls = 0
    const run = () => check(async () => ++calls === 1 ? { capability: { schemaHash: "b".repeat(64) } }
      : calls === 2 ? contractFixture() : repeated, "DEV100", { resourceUri: "adt://dev100/sap/bc/adt/source" })
    if (!repeated.notModified && repeated.contentHash === "c".repeat(64)) assert.equal((await run()).revalidation, "changed")
    else await assert.rejects(run, /INVALID_CONDITIONAL_PUBLIC_CONTRACT_RESULT/)
  }
})


test("public context evidence accepts missing KTD but rejects malformed or retained document bodies", async () => {
  const check = await loadContractCheck()
  for (const documentation of [
    { status: "not_found_or_unsupported", version: "active", objectName: "PRIVATE_NAME" },
    undefined,
    { ...contractFixture().documentation, returned: 2001 },
    { ...contractFixture().documentation, nextOffset: 13 }
  ]) {
    let calls = 0
    const run = () => check(async () => ++calls === 1 ? { capability: { schemaHash: "b".repeat(64) } }
      : calls === 2 ? { ...contractFixture(), documentation }
      : { view: "public_api", notModified: true, contentHash: "a".repeat(64) }, "DEV100", { resourceUri: "adt://dev100/sap/bc/adt/source" })
    if (documentation?.status === "not_found_or_unsupported") {
      assert.deepEqual((await run()).documentation, { status: "not_found_or_unsupported" })
    } else await assert.rejects(run, /INVALID_PUBLIC_CONTRACT_RESULT/)
  }
  let calls = 0
  await assert.rejects(() => check(async () => ++calls === 1 ? { capability: { schemaHash: "b".repeat(64) } }
    : calls === 2 ? contractFixture()
    : { view: "public_api", notModified: true, contentHash: "a".repeat(64), documentation: contractFixture().documentation },
    "DEV100", { resourceUri: "adt://dev100/sap/bc/adt/source" }), /INVALID_CONDITIONAL_PUBLIC_CONTRACT_RESULT/)
})

test("live contract evidence rejects missing, malformed or cross-system Resources before dispatch", async () => {
  const check = await loadContractCheck()
  for (const [source, reason] of [
    [{ sourceUri: "/sap/bc/adt/source" }, "INVALID_SOURCE_URI"],
    [{ resourceUri: "/sap/bc/adt/source" }, "INVALID_SOURCE_URI"],
    [{ resourceUri: "adt://dev100/sap/bc/adt/%xx" }, "INVALID_SOURCE_URI"],
    [{ resourceUri: "adt://prod100/sap/bc/adt/source" }, "SOURCE_SYSTEM_MISMATCH"]
  ] as const) {
    let calls = 0
    await assert.rejects(() => check(async () => { calls++ }, "DEV100", source), new RegExp(reason))
    assert.equal(calls, 0)
  }
})
