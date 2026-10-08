import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { ConnectionManager } from "../src/connection-manager.js"
import { createMcpServer } from "../src/mcp-server.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import { AbapToolService } from "../src/tool-service.js"

function fixture() {
  const service = new AbapToolService({} as ConnectionManager)
  const calls: Parameters<AbapToolService["getObjectLines"]>[0][] = []
  const paging = { totalLines: 100, truncated: false, nextLine: null as number | null }
  const sources = new Map(Array.from({ length: 5 }, (_, i) => [
    `ZOBJ${i}`, Array.from({ length: 100 }, (_, line) => `WRITE 'Object ${i} line ${line}'.`).join("\n")
  ]))
  service.getObjectLines = async input => {
    calls.push(input)
    const lines = (sources.get(input.objectName) ?? "").split("\n")
      .slice(input.startLine - 1, input.startLine - 1 + input.lineCount)
    return { connectionId: input.connectionId,
      object: { name: input.objectName, type: "CLAS/OC" },
      sourceUri: `/sap/bc/adt/oo/classes/${input.objectName.toLowerCase()}/source/main`,
      startLine: input.startLine, endLine: input.startLine + lines.length - 1, ...paging,
      code: lines.join("\n") }
  }
  return { service, calls, sources, paging }
}

async function connect(service: AbapToolService, mode: "full" | "minimal" | "single" = "full") {
  const server = createMcpServer(service, mode === "full" ? {} : resolveServeToolSelection("v1", undefined, mode))
  const client = new Client({ name: "conditional-batch-test", version: "1.0.0" })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  await client.connect(ct)
  let schemaHash = ""
  if (mode !== "full") {
    const args = { name: "sap.source.read_batch" }
    const described = await client.callTool(mode === "single"
      ? { name: "sap", arguments: { name: "describe", arguments: args } }
      : { name: "sap.capability.describe", arguments: args }) as CallToolResult
    schemaHash = (described.structuredContent?.data as any).capability.schemaHash
  }
  return {
    client,
    async read(requests: Array<Record<string, unknown>>, systemId = "DEV100") {
      const args = { systemId, requests }
      const invocation = { name: "sap.source.read_batch", schemaHash, arguments: args }
      return await client.callTool(mode === "full" ? { name: invocation.name, arguments: args }
        : mode === "single" ? { name: "sap", arguments: { ...invocation, risk: "read" } }
          : { name: "sap.capability.invoke_read", arguments: invocation }) as CallToolResult
    },
    async close() { await client.close(); await server.close(); service.dispose() }
  }
}

for (const mode of ["full", "minimal", "single"] as const) {
  test(`conditional source batches omit only unchanged code after fresh reads (${mode})`, async t => {
    const { service, calls, sources } = fixture()
    const h = await connect(service, mode)
    t.after(() => h.close())
    const requests = [...sources.keys()].map(objectName => ({ objectName, startLine: 1, lineCount: 100 }))
    const first = await h.read(requests)
    const data = first.structuredContent?.data as any
    assert.equal(first.structuredContent?.status, "succeeded")
    const conditional = requests.map((request, i) => {
      assert.match(data.results[i].result.contentHash, /^[0-9a-f]{64}$/)
      assert.equal(data.results[i].result.notModified, false)
      return { ...request, ifNoneMatch: data.results[i].result.contentHash }
    })
    const repeat = await h.read(conditional)
    const repeated = repeat.structuredContent?.data as any
    assert.equal(repeated.returnedSourceBytes, 0)
    assert.equal(repeated.truncated, false)
    for (const [i, item] of repeated.results.entries()) {
      assert.equal(item.ok, true)
      assert.equal(item.result.notModified, true)
      assert.equal("code" in item.result, false)
      assert.equal(item.result.contentHash, data.results[i].result.contentHash)
      assert.equal("ifNoneMatch" in item.request, false, "A successful reply need not repeat the supplied validator")
      assert.equal(item.result.nextLine, null)
    }
    assert.equal(calls.length, 10, "All unchanged objects still go through the authorized read path")
    assert.ok(Buffer.byteLength(JSON.stringify(repeat)) < Buffer.byteLength(JSON.stringify(first)) * 0.3)
    sources.set("ZOBJ1", "WRITE 'External edit'.")
    const edited = (await h.read(conditional)).structuredContent?.data as any
    assert.equal(edited.results[1].result.notModified, false)
    assert.equal(edited.results[1].result.code, sources.get("ZOBJ1"))
    assert.notEqual(edited.results[1].result.contentHash, data.results[1].result.contentHash)
    assert.equal(edited.results[0].result.notModified, true)
    assert.equal(edited.returnedSourceBytes, Buffer.byteLength(sources.get("ZOBJ1")!))
    const full = (await h.read(requests)).structuredContent?.data as any
    assert.equal(full.results[0].result.code, sources.get("ZOBJ0"), "A caller can request full code again")
  })
}

test("batch validators bind system, request range, object and returned paging metadata", async t => {
  const { service, paging } = fixture()
  const h = await connect(service)
  t.after(() => h.close())
  const request = { objectName: "ZOBJ0", startLine: 1, lineCount: 100 }
  const first = (await h.read([request])).structuredContent?.data as any
  const hash = first.results[0].result.contentHash
  for (const [change, systemId] of [[{}, "QA100"], [{ startLine: 2 }, "DEV100"],
    [{ lineCount: 50 }, "DEV100"], [{ objectName: "ZOBJ1" }, "DEV100"]] as const) {
    const result = (await h.read([{ ...request, ...change, ifNoneMatch: hash }], systemId)).structuredContent?.data as any
    assert.equal(result.results[0].result.notModified, false)
    assert.notEqual(result.results[0].result.contentHash, hash)
  }
  paging.totalLines = 101
  const metadata = (await h.read([{ ...request, ifNoneMatch: hash }])).structuredContent?.data as any
  assert.equal(metadata.results[0].result.notModified, false)
})

test("unchanged batch pages free the byte budget and keep later objects readable", async t => {
  const { service, calls, sources } = fixture()
  for (const name of sources.keys()) sources.set(name, "한".repeat(10000))
  const h = await connect(service)
  t.after(() => h.close())
  const first = (await h.read([{ objectName: "ZOBJ0", lineCount: 1 }])).structuredContent?.data as any
  const hash = first.results[0].result.contentHash
  const repeated = (await h.read([
    ...Array.from({ length: 4 }, () => ({ objectName: "ZOBJ0", lineCount: 1, ifNoneMatch: hash })),
    { objectName: "ZOBJ4", lineCount: 1 }
  ])).structuredContent?.data as any
  assert.equal(repeated.returnedSourceBytes, 30000)
  assert.equal(repeated.truncated, false)
  assert.equal(repeated.results[4].result.code, sources.get("ZOBJ4"))
  assert.equal(calls.length, 6, "Conditional omissions must not defer the fifth read")
})

test("conditional batch failures cannot turn revoked access into an unchanged success", async t => {
  const { service, calls } = fixture()
  const h = await connect(service)
  t.after(() => h.close())
  const request = { objectName: "ZOBJ0", lineCount: 100 }
  const first = (await h.read([request])).structuredContent?.data as any
  const hash = first.results[0].result.contentHash
  const invalid = await h.read([{ ...request, ifNoneMatch: "invalid" }])
  assert.equal(invalid.isError, true)
  assert.equal(calls.length, 1)
  service.getObjectLines = async () => { throw new Error("Authorization: Bearer PRIVATE_TOKEN\nSAP access denied") }
  const denied = await h.read([{ ...request, ifNoneMatch: hash }])
  assert.equal(denied.structuredContent?.status, "partial")
  const item = (denied.structuredContent?.data as any).results[0]
  assert.equal(item.ok, false)
  assert.equal(item.result, undefined)
  assert.equal(item.request.ifNoneMatch, hash, "Failed requests retain their retry arguments")
  assert.doesNotMatch(JSON.stringify(denied), /PRIVATE_TOKEN/)
})

test("conditional batches distinguish empty code and preserve truncated continuation", async t => {
  const { service, sources, paging } = fixture()
  sources.set("ZOBJ0", "")
  const h = await connect(service)
  t.after(() => h.close())
  const request = { objectName: "ZOBJ0", lineCount: 1 }
  const first = (await h.read([request])).structuredContent?.data as any
  assert.equal(first.results[0].result.code, "")
  const repeat = (await h.read([{ ...request, ifNoneMatch: first.results[0].result.contentHash }])).structuredContent?.data as any
  assert.equal(repeat.results[0].result.notModified, true)
  assert.equal("code" in repeat.results[0].result, false)
  paging.truncated = true
  paging.nextLine = 101
  const partial = await h.read([request])
  const result = (partial.structuredContent?.data as any).results[0].result
  const unchanged = await h.read([{ ...request, ifNoneMatch: result.contentHash }])
  assert.equal(unchanged.structuredContent?.status, "partial")
  const page = (unchanged.structuredContent?.data as any).results[0].result
  assert.equal(page.notModified, true)
  assert.equal(page.nextLine, 101)
  assert.equal(page.truncated, true)
})

test("a byte-truncated batch validator cannot hide source when more budget becomes available", async t => {
  const { service, sources } = fixture()
  for (const name of sources.keys()) sources.set(name, "한".repeat(20000))
  const h = await connect(service)
  t.after(() => h.close())
  const requests = ["ZOBJ0", "ZOBJ1"].map(objectName => ({ objectName, lineCount: 1 }))
  const first = await h.read(requests)
  assert.equal(first.structuredContent?.status, "partial")
  const data = first.structuredContent?.data as any
  assert.equal(data.returnedSourceBytes, 60000)
  assert.equal(data.results[1].result.code, "")
  assert.equal(data.results[1].result.truncationReason, "batch_byte_budget")
  const second = await h.read(requests.map((request, i) => ({ ...request, ifNoneMatch: data.results[i].result.contentHash })))
  const rechecked = second.structuredContent?.data as any
  assert.equal(second.structuredContent?.status, "succeeded")
  assert.equal(rechecked.returnedSourceBytes, 60000)
  assert.equal(rechecked.results[0].result.notModified, true)
  assert.equal(rechecked.results[1].result.notModified, false)
  assert.equal(rechecked.results[1].result.code, sources.get("ZOBJ1"))
})
