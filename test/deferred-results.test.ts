import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  DEFERRED_RESULT_ENVELOPE_BYTE_LIMIT,
  DEFERRED_RESULT_INLINE_BYTE_LIMIT,
  DEFERRED_RESULT_TOOL_NAME,
  DeferredResultStore,
  type DeferredResultEnvelope
} from "../src/deferred-results.js"
import { AppError } from "../src/errors.js"
import { createMcpServer } from "../src/mcp-server.js"
import type { AbapToolService } from "../src/tool-service.js"

function appErrorCode(operation: () => unknown): string | undefined {
  try {
    operation()
    return undefined
  } catch (error) {
    return error instanceof AppError ? error.code : undefined
  }
}

function responseText(response: unknown): string {
  return (
    (response as { content: Array<{ type: "text"; text: string }> }).content[0] as {
      type: "text"
      text: string
    }
  ).text
}

test("default inline results are capped at 16 KiB before deferral", () => {
  assert.equal(DEFERRED_RESULT_INLINE_BYTE_LIMIT, 16 * 1024)
})

test("deferred result store preserves the inline threshold and bounds its envelope", () => {
  const store = new DeferredResultStore()
  assert.equal(store.defer("X".repeat(DEFERRED_RESULT_INLINE_BYTE_LIMIT)), undefined)

  const text = "X".repeat(DEFERRED_RESULT_INLINE_BYTE_LIMIT + 1)
  const envelope = store.defer(text)
  assert.ok(envelope)
  assert.equal(envelope.format, "compact-v1")
  assert.ok(
    Buffer.byteLength(JSON.stringify(envelope), "utf8") <=
      DEFERRED_RESULT_ENVELOPE_BYTE_LIMIT
  )
  assert.equal(Buffer.from(text, "utf8").subarray(0, envelope.previewBytes).toString("utf8"), envelope.previewText)
  assert.equal(envelope.nextOffset, envelope.previewBytes)
})

test("deferred result chunks reconstruct mixed UTF-8 JSON exactly", () => {
  const store = new DeferredResultStore()
  const text = JSON.stringify({ content: "한글😀\n\\\"".repeat(8000) })
  const envelope = store.defer(text)
  assert.ok(envelope)

  let offset = 0
  let reconstructed = ""
  while (true) {
    const chunk = store.read(envelope.resultId, offset, 4096)
    reconstructed += chunk.content
    assert.equal(Buffer.byteLength(chunk.content, "utf8"), chunk.returnedBytes)
    assert.ok(
      Buffer.byteLength(JSON.stringify(chunk), "utf8") <=
        DEFERRED_RESULT_INLINE_BYTE_LIMIT
    )
    if (chunk.done) {
      assert.equal(chunk.nextOffset, null)
      break
    }
    assert.ok(chunk.nextOffset !== null && chunk.nextOffset > offset)
    offset = chunk.nextOffset
  }

  assert.equal(reconstructed, text)
  assert.deepEqual(JSON.parse(reconstructed), JSON.parse(text))
})

test("deferred result store expires and evicts entries with stable error codes", () => {
  let now = 0
  const store = new DeferredResultStore({
    inlineByteLimit: 0,
    maxEntries: 2,
    maxCacheBytes: 1024,
    ttlMs: 100,
    now: () => now
  })
  const first = store.defer("first")!
  now = 1
  const second = store.defer("second")!
  now = 2
  store.defer("third")
  assert.equal(appErrorCode(() => store.read(first.resultId)), "DEFERRED_RESULT_NOT_FOUND")
  assert.equal(store.read(second.resultId).content, "second")

  now = 101
  assert.equal(appErrorCode(() => store.read(second.resultId)), "DEFERRED_RESULT_EXPIRED")
  assert.equal(appErrorCode(() => store.read("missing")), "DEFERRED_RESULT_NOT_FOUND")
})

test("deferred result store enforces its total byte budget", () => {
  const store = new DeferredResultStore({
    inlineByteLimit: 0,
    maxEntries: 20,
    maxCacheBytes: 8
  })
  const first = store.defer("12345")!
  const second = store.defer("67890")!
  assert.equal(appErrorCode(() => store.read(first.resultId)), "DEFERRED_RESULT_NOT_FOUND")
  assert.equal(store.read(second.resultId).content, "67890")
  assert.equal(store.defer("123456789"), undefined)
})

test("deferred result store rejects invalid chunk sizes and UTF-8 offsets", () => {
  const store = new DeferredResultStore({ inlineByteLimit: 0 })
  const envelope = store.defer("😀abc")!
  assert.equal(
    appErrorCode(() => store.read(envelope.resultId, 0, 3)),
    "DEFERRED_RESULT_CHUNK_SIZE_INVALID"
  )
  assert.equal(
    appErrorCode(() => store.read(envelope.resultId, 1, 4)),
    "DEFERRED_RESULT_OFFSET_INVALID"
  )
  assert.equal(
    appErrorCode(() => store.read(envelope.resultId, 100, 4)),
    "DEFERRED_RESULT_OFFSET_INVALID"
  )
})

test("MCP defers only large results and reads them without repeating the operation", async t => {
  let value = "X".repeat(DEFERRED_RESULT_INLINE_BYTE_LIMIT - 2)
  let operationCalls = 0
  const service = {
    async getConnectedSystems() {
      operationCalls += 1
      return value
    }
  } as unknown as AbapToolService
  const server = createMcpServer(service, {
    enabledV0Tools: new Set(["get_connected_systems", DEFERRED_RESULT_TOOL_NAME])
  })
  const client = new Client({ name: "deferred-result-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const inline = await client.callTool({ name: "get_connected_systems", arguments: {} })
  assert.equal(responseText(inline), JSON.stringify(value))
  assert.equal(Buffer.byteLength(responseText(inline), "utf8"), DEFERRED_RESULT_INLINE_BYTE_LIMIT)

  value = "Y".repeat(DEFERRED_RESULT_INLINE_BYTE_LIMIT - 1)
  const deferred = await client.callTool({ name: "get_connected_systems", arguments: {} })
  const deferredText = responseText(deferred)
  const envelope = JSON.parse(deferredText) as DeferredResultEnvelope
  assert.equal(envelope.deferred, true)
  assert.equal(envelope.format, "compact-v1")
  assert.equal(envelope.originalBytes, DEFERRED_RESULT_INLINE_BYTE_LIMIT + 1)
  assert.ok(envelope.summary)
  assert.ok(Buffer.byteLength(deferredText, "utf8") <= DEFERRED_RESULT_ENVELOPE_BYTE_LIMIT)

  let reconstructed = envelope.previewText
  let offset: number | null = envelope.nextOffset
  while (offset !== null) {
    const response = await client.callTool({
      name: DEFERRED_RESULT_TOOL_NAME,
      arguments: { resultId: envelope.resultId, offset, maxBytes: 4096 }
    })
    const chunk = JSON.parse(responseText(response)) as {
      content: string
      nextOffset: number | null
    }
    reconstructed += chunk.content
    offset = chunk.nextOffset
  }
  assert.equal(reconstructed, JSON.stringify(value))
  assert.equal(operationCalls, 2)
})

test("MCP uses the search-specific summary for repeated context", async t => {
  const lines = Array.from({ length: 60 }, (_, index) => `${index + 1} ${"X".repeat(80)}`)
  const matches = Array.from({ length: 20 }, (_, index) => index + 10).map(lineNumber => ({
    lineNumber,
    line: lines[lineNumber - 1],
    context: lines.slice(lineNumber - 4, lineNumber + 3).map((text, contextIndex) => ({
      lineNumber: lineNumber - 3 + contextIndex,
      text,
      isMatch: contextIndex === 3
    }))
  }))
  const value = {
    connectionId: "DEV100",
    objectPattern: "ZCL_BANK",
    searchTerm: "BANK",
    isRegexp: false,
    objectsSearched: 1,
    matchCount: matches.length,
    startIndex: 0,
    returnedMatches: matches.length,
    truncated: false,
    nextStartIndex: null,
    results: [{
      object: { name: "ZCL_BANK", type: "CLAS/OC" },
      sourceUri: "/sap/bc/adt/oo/classes/zcl_bank/source/main",
      totalLines: lines.length,
      matches,
      enhancementMatches: []
    }]
  }
  const originalText = JSON.stringify(value)
  assert.ok(Buffer.byteLength(originalText, "utf8") > 16 * 1024)
  let operationCalls = 0
  const service = {
    async searchObjectLines() {
      operationCalls += 1
      return value
    }
  } as unknown as AbapToolService
  const server = createMcpServer(service, {
    enabledV0Tools: new Set(["search_abap_object_lines", DEFERRED_RESULT_TOOL_NAME])
  })
  const client = new Client({ name: "compact-search-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const response = await client.callTool({
    name: "search_abap_object_lines",
    arguments: {
      objectName: "ZCL_BANK",
      searchTerm: "BANK",
      connectionId: "DEV100"
    }
  })
  const compactText = responseText(response)
  const envelope = JSON.parse(compactText) as DeferredResultEnvelope
  assert.equal(envelope.format, "compact-v1")
  assert.equal(envelope.previewBytes, 0)
  assert.equal(envelope.nextOffset, 0)
  assert.equal(
    (envelope.summary as { kind: string }).kind,
    "search_abap_object_lines"
  )
  assert.ok(Buffer.byteLength(compactText, "utf8") <= DEFERRED_RESULT_ENVELOPE_BYTE_LIMIT)
  assert.ok(
    Buffer.byteLength(compactText, "utf8") < Buffer.byteLength(originalText, "utf8") / 2
  )

  let reconstructed = ""
  let offset: number | null = 0
  while (offset !== null) {
    const chunkResponse = await client.callTool({
      name: DEFERRED_RESULT_TOOL_NAME,
      arguments: { resultId: envelope.resultId, offset }
    })
    const chunk = JSON.parse(responseText(chunkResponse)) as {
      content: string
      nextOffset: number | null
    }
    reconstructed += chunk.content
    offset = chunk.nextOffset
  }
  assert.equal(reconstructed, originalText)
  assert.equal(operationCalls, 1)
})

test("MCP keeps error essentials inline and preserves full deferred error details", async t => {
  let operationCalls = 0
  const service = {
    async getConnectedSystems() {
      operationCalls += 1
      throw new AppError("SAP_OPERATION_FAILED", "SAP request failed", {
        status: 500,
        endpoint: "/sap/bc/adt/example",
        responseText: "E".repeat(DEFERRED_RESULT_INLINE_BYTE_LIMIT)
      })
    }
  } as unknown as AbapToolService
  const server = createMcpServer(service, {
    enabledV0Tools: new Set(["get_connected_systems", DEFERRED_RESULT_TOOL_NAME])
  })
  const client = new Client({ name: "deferred-error-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const response = await client.callTool({ name: "get_connected_systems", arguments: {} }) as {
    content: Array<{ type: "text"; text: string }>
    isError?: boolean
  }
  assert.equal(response.isError, true)
  const envelope = JSON.parse(responseText(response)) as DeferredResultEnvelope
  assert.deepEqual(envelope.error, {
    code: "SAP_OPERATION_FAILED",
    message: "SAP request failed",
    status: 500,
    endpoint: "/sap/bc/adt/example"
  })

  let reconstructed = envelope.previewText
  let offset: number | null = envelope.nextOffset
  while (offset !== null) {
    const chunkResponse = await client.callTool({
      name: DEFERRED_RESULT_TOOL_NAME,
      arguments: { resultId: envelope.resultId, offset }
    })
    const chunk = JSON.parse(responseText(chunkResponse)) as {
      content: string
      nextOffset: number | null
    }
    reconstructed += chunk.content
    offset = chunk.nextOffset
  }
  const payload = JSON.parse(reconstructed)
  assert.equal(payload.details.responseText.length, DEFERRED_RESULT_INLINE_BYTE_LIMIT)
  assert.equal(operationCalls, 1)
})

test("MCP preserves inline behavior when deferred result reading is filtered out", async t => {
  const value = "X".repeat(DEFERRED_RESULT_INLINE_BYTE_LIMIT)
  const service = {
    async getConnectedSystems() {
      return value
    }
  } as unknown as AbapToolService
  const server = createMcpServer(service, {
    enabledV0Tools: new Set(["get_connected_systems"])
  })
  const client = new Client({ name: "inline-filter-test", version: "1.0.0" })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)

  const response = await client.callTool({ name: "get_connected_systems", arguments: {} })
  assert.equal(responseText(response), JSON.stringify(value))
})
