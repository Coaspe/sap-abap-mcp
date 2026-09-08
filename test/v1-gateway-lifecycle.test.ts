import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerAdaptiveV1Tools } from "../src/mcp/v1/adaptive-tools.js"
import { v1Success } from "../src/mcp/v1/result.js"

for (const singleTool of [false, true]) {
  for (const state of ["cold", "ready", "initializing"] as const) {
    test(`gateway close is terminal in ${singleTool ? "single" : "adaptive"} mode (${state})`, async () => {
      const outer = new McpServer({ name: "lifecycle-outer", version: "1" })
      const inner = new McpServer({ name: "lifecycle-inner", version: "1" })
      let created = 0
      let executed = 0
      let closed = 0
      let release!: () => void
      let started!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const initializing = new Promise<void>(resolve => { started = resolve })
      const connect = inner.connect.bind(inner)
      const close = inner.close.bind(inner)
      inner.connect = async transport => {
        await connect(transport)
        started()
        if (state === "initializing") await barrier
      }
      inner.close = async () => { closed++; await close() }
      inner.registerTool("sap.test.read", { inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
        executed++
        return v1Success({ executed })
      })
      const gateway = registerAdaptiveV1Tools(outer, {
        singleTool, createInternalServer: () => { created++; return inner }
      })
      const client = new Client({ name: "lifecycle-client", version: "1" })
      const [ct, st] = InMemoryTransport.createLinkedPair()
      const discovery = (name: "search" | "describe") => client.callTool({
        name: singleTool ? "sap" : `sap.capability.${name}`,
        arguments: singleTool ? { name, arguments: { name: "sap.test.read" } } : { name: "sap.test.read" }
      })
      try {
        await outer.connect(st)
        await client.connect(ct)
        let hash = "0".repeat(64)
        if (state === "ready") {
          const result = await discovery("describe")
          hash = (result.structuredContent as any).data.capability.schemaHash
        }
        const pending = state === "initializing" ? discovery("search") : undefined
        if (pending) await initializing
        const closing = gateway.close()
        assert.equal(gateway.close(), closing)
        release()
        await closing
        const results = [
          ...(pending ? [await pending] : []),
          await discovery("search"),
          await discovery("describe"),
          await client.callTool({ name: singleTool ? "sap" : "sap.capability.invoke_read",
            arguments: { name: "sap.test.read", schemaHash: hash, ...(singleTool ? { risk: "read" } : {}) } })
        ]
        for (const result of results) {
          assert.equal(result.isError, true)
          const content = result.content as Array<{ type: string; text?: string }>
          const error = JSON.parse(content.find(item => item.type === "text")!.text!)
          assert.equal(error.code, "CAPABILITY_GATEWAY_CLOSED")
          assert.equal(error.category, "transport")
        }
        assert.equal(created, state === "cold" ? 0 : 1)
        assert.equal(closed, created)
        assert.equal(executed, 0)
      } finally {
        release()
        await gateway.close()
        await client.close()
        await outer.close()
        await close()
      }
    })
  }
}
