import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CompleteRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js"
import { installV1CompletionRouter } from "../src/mcp/v1/completion-router.js"

async function connectedClient(server: McpServer) {
  const client = new Client({
    name: "v1-completion-router-test-client",
    version: "1.0.0"
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return {
    client,
    async close() {
      await client.close()
      await server.close()
    }
  }
}

async function connectedRouter() {
  const server = new McpServer({
    name: "v1-completion-router-test",
    version: "1.0.0"
  })
  const router = installV1CompletionRouter(server)
  return { ...await connectedClient(server), router }
}

test("resource references reach only the resource provider and preserve completion bounds", async t => {
  const connection = await connectedRouter()
  t.after(() => connection.close())
  let promptCalls = 0

  connection.router.setResourceProvider(async request => {
    assert.equal(request.params.ref.type, "ref/resource")
    assert.equal(request.params.ref.uri, "memo://{name}")
    assert.deepEqual(request.params.argument, { name: "name", value: "v" })
    return Array.from({ length: 105 }, (_, index) => `value-${index}`)
  })
  connection.router.setPromptProvider(async () => {
    promptCalls += 1
    return ["wrong-provider"]
  })

  const result = await connection.client.complete({
    ref: { type: "ref/resource", uri: "memo://{name}" },
    argument: { name: "name", value: "v" }
  })

  assert.equal(promptCalls, 0)
  assert.deepEqual(
    result.completion.values,
    Array.from({ length: 100 }, (_, index) => `value-${index}`)
  )
  assert.equal(result.completion.total, 105)
  assert.equal(result.completion.hasMore, true)
})

test("prompt references reach only the prompt provider", async t => {
  const connection = await connectedRouter()
  t.after(() => connection.close())
  let resourceCalls = 0

  connection.router.setResourceProvider(async () => {
    resourceCalls += 1
    return ["wrong-provider"]
  })
  connection.router.setPromptProvider(async request => {
    assert.equal(request.params.ref.type, "ref/prompt")
    assert.equal(request.params.ref.name, "choose-system")
    assert.deepEqual(request.params.argument, { name: "system", value: "D" })
    return ["DEV100"]
  })

  const result = await connection.client.complete({
    ref: { type: "ref/prompt", name: "choose-system" },
    argument: { name: "system", value: "D" }
  })

  assert.equal(resourceCalls, 0)
  assert.deepEqual(result.completion, {
    values: ["DEV100"],
    total: 1,
    hasMore: false
  })
})

test("missing providers fail with InvalidParams", async t => {
  const connection = await connectedRouter()
  t.after(() => connection.close())

  const cases = [
    {
      ref: { type: "ref/resource" as const, uri: "memo://{name}" },
      argument: { name: "name", value: "v" }
    },
    {
      ref: { type: "ref/prompt" as const, name: "choose-system" },
      argument: { name: "system", value: "D" }
    }
  ]

  for (const request of cases) {
    await assert.rejects(
      () => connection.client.complete(request),
      (error: unknown) => {
        assert.ok(error instanceof McpError)
        assert.equal(error.code, ErrorCode.InvalidParams)
        return true
      }
    )
  }
})

test("provider failures are sanitized with one MCP prefix", async t => {
  const connection = await connectedRouter()
  t.after(() => connection.close())
  connection.router.setResourceProvider(async () => {
    throw new Error("client_secret:\n  completion-secret")
  })

  await assert.rejects(
    () => connection.client.complete({
      ref: { type: "ref/resource", uri: "memo://{name}" },
      argument: { name: "name", value: "v" }
    }),
    (error: unknown) => {
      assert.ok(error instanceof McpError)
      assert.equal(error.code, ErrorCode.InternalError)
      assert.equal(error.message.includes("completion-secret"), false)
      const prefix = `MCP error ${ErrorCode.InternalError}: `
      assert.equal(error.message.startsWith(prefix), true)
      assert.equal(error.message.slice(prefix.length).startsWith("MCP error"), false)
      return true
    }
  )
})

test("a duplicate resource provider is rejected without replacing the first", async t => {
  const connection = await connectedRouter()
  t.after(() => connection.close())
  connection.router.setResourceProvider(async () => ["first"])

  assert.throws(
    () => connection.router.setResourceProvider(async () => ["second"]),
    (error: unknown) => {
      assert.ok(error instanceof McpError)
      assert.equal(error.code, ErrorCode.InvalidParams)
      return true
    }
  )

  const result = await connection.client.complete({
    ref: { type: "ref/resource", uri: "memo://{name}" },
    argument: { name: "name", value: "v" }
  })
  assert.deepEqual(result.completion.values, ["first"])
})

test("a duplicate prompt provider is rejected without replacing the first", async t => {
  const connection = await connectedRouter()
  t.after(() => connection.close())
  connection.router.setPromptProvider(async () => ["first"])

  assert.throws(
    () => connection.router.setPromptProvider(async () => ["second"]),
    (error: unknown) => {
      assert.ok(error instanceof McpError)
      assert.equal(error.code, ErrorCode.InvalidParams)
      return true
    }
  )

  const result = await connection.client.complete({
    ref: { type: "ref/prompt", name: "choose-system" },
    argument: { name: "system", value: "D" }
  })
  assert.deepEqual(result.completion.values, ["first"])
})

test("a second router installation is rejected without replacing the first", async t => {
  const server = new McpServer({
    name: "v1-completion-router-test",
    version: "1.0.0"
  })
  const router = installV1CompletionRouter(server)
  router.setResourceProvider(async () => ["first"])

  assert.throws(
    () => installV1CompletionRouter(server),
    /A request handler for completion\/complete already exists/
  )

  const connection = await connectedClient(server)
  t.after(() => connection.close())
  const result = await connection.client.complete({
    ref: { type: "ref/resource", uri: "memo://{name}" },
    argument: { name: "name", value: "v" }
  })
  assert.deepEqual(result.completion.values, ["first"])
})

test("router installation rejects and preserves an unrelated completion handler", async t => {
  const server = new McpServer({
    name: "v1-completion-router-test",
    version: "1.0.0"
  })
  server.server.registerCapabilities({ completions: {} })
  server.server.setRequestHandler(CompleteRequestSchema, async () => ({
    completion: {
      values: ["unrelated"],
      total: 1,
      hasMore: false
    }
  }))

  assert.throws(
    () => installV1CompletionRouter(server),
    /A request handler for completion\/complete already exists/
  )

  const connection = await connectedClient(server)
  t.after(() => connection.close())
  const result = await connection.client.complete({
    ref: { type: "ref/resource", uri: "memo://{name}" },
    argument: { name: "name", value: "v" }
  })
  assert.deepEqual(result.completion.values, ["unrelated"])
})
