import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../src/mcp-server.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import type { AbapToolService } from "../src/tool-service.js"

const capabilities = [
  { name: "sap.quality.unit_test", args: { systemId: "DEV100", objectName: "ZCL_FIXTURE" } },
  { name: "sap.transport.assess", args: { systemId: "DEV100", transportNumber: "DEVK900001", checks: ["unit_tests"] } }
]

for (const { name, args } of capabilities) {
  for (const mode of ["full", "minimal", "adaptive", "single"] as const) {
    for (const role of ["viewer", "developer"] as const) {
      test(`${name} ${mode} ${role} enforces execution risk before the service callback`, async t => {
        let executions = 0
        const service = {
          async runUnitTests() { executions++; return { connectionId: "DEV100", tests: [] } },
          async manageTransportRequests() { executions++; return { connectionId: "DEV100", assessment: {} } }
        } as unknown as AbapToolService
        const server = createMcpServer(service, { apiVersion: "v1", role,
          ...(mode === "full" ? {} : resolveServeToolSelection("v1", undefined, mode)) })
        const client = new Client({ name: "unit-execution-policy", version: "1" })
        const [a, b] = InMemoryTransport.createLinkedPair()
        t.after(async () => { await client.close(); await server.close() })
        await server.connect(b); await client.connect(a)
        const tools = (await client.listTools()).tools
        if (mode === "full") {
          const tool = tools.find(tool => tool.name === name)
          if (role === "viewer") {
            await client.callTool({ name, arguments: args }).catch(() => undefined)
            t.diagnostic(JSON.stringify({ mode, role, executions, advertised: Boolean(tool) }))
            assert.equal(executions, 0)
            assert.equal(tool, undefined)
          } else {
            assert.equal(tool?.annotations?.readOnlyHint, false)
            assert.equal(tool?.annotations?.idempotentHint, false)
            assert.notEqual((await client.callTool({ name, arguments: args })).isError, true)
            assert.equal(executions, 1)
          }
          return
        }
        const described = await client.callTool(mode === "single"
          ? { name: "sap", arguments: { name: "describe", arguments: { name } } }
          : { name: "sap.capability.describe", arguments: { name } })
        const envelope = described.structuredContent as Record<string, unknown> | undefined
        const capability = (envelope?.data as { capability?: { risk: string; schemaHash: string } } | undefined)?.capability
        const invoke = (risk: string) => client.callTool(mode === "single"
          ? { name: "sap", arguments: { name, risk, schemaHash: capability?.schemaHash ?? "0".repeat(64), arguments: args } }
          : { name: `sap.capability.invoke_${risk}`, arguments: { name, schemaHash: capability?.schemaHash ?? "0".repeat(64), arguments: args } })
        const read = await invoke("read")
        t.diagnostic(JSON.stringify({ mode, role, executions, advertisedRisk: capability?.risk }))
        assert.equal(executions, 0, "A read gateway must never execute application tests")
        assert.equal(read.isError, true)
        if (role === "viewer") {
          assert.equal(described.isError, true)
          assert.equal(capability, undefined)
        } else {
          assert.equal(capability?.risk, "write")
          assert.notEqual((await invoke("write")).isError, true)
          assert.equal(executions, 1)
        }
      })
    }
  }
}

for (const role of ["viewer", "developer"] as const) {
  test(`legacy run_unit_tests ${role} enforces execution risk before the service callback`, async t => {
    let executions = 0
    const service = { async runUnitTests() { executions++; return { connectionId: "DEV100", tests: [] } } } as unknown as AbapToolService
    const server = createMcpServer(service, { apiVersion: "v0", role })
    const client = new Client({ name: "legacy-unit-execution-policy", version: "1" })
    const [a, b] = InMemoryTransport.createLinkedPair()
    t.after(async () => { await client.close(); await server.close() })
    await server.connect(b); await client.connect(a)
    const tool = (await client.listTools()).tools.find(tool => tool.name === "run_unit_tests")
    const request = { name: "run_unit_tests", arguments: { connectionId: "DEV100", objectName: "ZCL_FIXTURE" } }
    if (role === "viewer") {
      await client.callTool(request).catch(() => undefined)
      t.diagnostic(JSON.stringify({ role, executions, advertised: Boolean(tool) }))
      assert.equal(executions, 0)
      assert.equal(tool, undefined)
    } else {
      assert.equal(tool?.annotations?.readOnlyHint, false)
      assert.equal(tool?.annotations?.idempotentHint, false)
      assert.notEqual((await client.callTool(request)).isError, true)
      assert.equal(executions, 1)
    }
  })
}
