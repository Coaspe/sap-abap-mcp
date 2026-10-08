import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ProgressNotificationSchema, type ProgressNotification } from "@modelcontextprotocol/sdk/types.js"
import { instrumentProgress } from "../src/mcp/progress-instrumentation.js"
import { createMcpServer } from "../src/mcp-server.js"
import { AppError } from "../src/errors.js"
import type { AbapToolService } from "../src/tool-service.js"

for (const mode of ["direct", "minimal", "single"] as const) {
  test(`progress reaches a real MCP client through ${mode} mode without changing results`, async t => {
    let calls = 0
    let fail = false
    const service = { async getConnectedSystems() {
      calls += 1
      if (fail) throw new AppError("AUTH_REQUIRED", "Login required")
      return { systems: [] }
    } } as unknown as AbapToolService
    const server = createMcpServer(service, {
      apiVersion: "v1", enabledV1Tools: new Set(["sap.system.list"]), enabledV1Resources: new Set(),
      ...(mode === "direct" ? {} : { adaptive: true, singleTool: mode === "single" })
    })
    const client = new Client({ name: "progress-test", version: "1" })
    t.after(async () => { await client.close(); await server.close() })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const notifications: ProgressNotification["params"][] = []
    client.setNotificationHandler(ProgressNotificationSchema, notification => {
      notifications.push(notification.params)
    })
    const request = mode === "direct" ? { name: "sap.system.list", arguments: {} } : await (async () => {
      const describe = mode === "single"
        ? { name: "sap", arguments: { name: "describe", arguments: { name: "sap.system.list" } } }
        : { name: "sap.capability.describe", arguments: { name: "sap.system.list" } }
      const description = await client.callTool(describe)
      const data = (description.structuredContent as { data: { capability: { schemaHash: string } } }).data.capability
      return mode === "single"
        ? { name: "sap", arguments: { name: "sap.system.list", risk: "read", schemaHash: data.schemaHash, arguments: {} } }
        : { name: "sap.capability.invoke_read", arguments: { name: "sap.system.list", schemaHash: data.schemaHash, arguments: {} } }
    })()
    for (const token of ["call-1", 0]) {
      const result = await client.callTool({ ...request, _meta: { progressToken: token } })
      assert.notEqual(result.isError, true)
      assert.deepEqual((result.structuredContent as { data: unknown }).data, { systems: [] })
      const events = notifications.filter(item => item.progressToken === token)
      assert.deepEqual(events.map(item => item.progress), [0, 1])
      assert.match(events[0]!.message!, /started$/)
      assert.match(events[1]!.message!, /finished$/)
      assert.equal(events[1]!.total, undefined)
    }
    const count = notifications.length
    await client.callTool(request)
    assert.equal(notifications.length, count)
    fail = true
    const failure = await client.callTool({ ...request, _meta: { progressToken: "failure" } })
    assert.equal(failure.isError, true)
    assert.match(notifications.at(-1)!.message!, /failed$/)
    assert.equal(calls, 4)
  })
}

test("long calls send elapsed progress, stop on cancellation, and tolerate notification failure", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const server = new McpServer({ name: "heartbeat-test", version: "1" })
  let callback: ((...args: any[]) => Promise<unknown>) | undefined
  server.registerTool = ((_name: string, _config: unknown, handler: typeof callback) => {
    callback = handler
  }) as never
  instrumentProgress(server)
  let finish: (() => void) | undefined
  let calls = 0
  server.registerTool("wait", {}, async () => {
    calls += 1
    await new Promise<void>(resolve => { finish = resolve })
    return { content: [{ type: "text", text: "done" }] }
  })
  const signal = new AbortController()
  const notifications: ProgressNotification[] = []
  const operation = callback!({ signal: signal.signal, _meta: { progressToken: 0 },
    async sendNotification(notification: ProgressNotification) { notifications.push(notification) } })
  await new Promise<void>(resolve => setImmediate(resolve))
  t.mock.timers.tick(5000)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(notifications.map(item => item.params.progress), [0, 1])
  assert.match(notifications[1]!.params.message!, /still running/)
  signal.abort()
  t.mock.timers.tick(10_000)
  finish!()
  await operation
  assert.equal(notifications.length, 2)
  const rejectedNotification = callback!({ signal: new AbortController().signal,
    _meta: { progressToken: "closed" }, async sendNotification() { throw new Error("Transport closed") } })
  await new Promise<void>(resolve => setImmediate(resolve))
  finish!()
  const result = await rejectedNotification
  assert.deepEqual(result, { content: [{ type: "text", text: "done" }] })
  assert.equal(calls, 2)
})
