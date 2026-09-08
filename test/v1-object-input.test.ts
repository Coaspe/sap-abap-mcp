import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { createMcpServer } from "../src/mcp-server.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import type { AbapToolService } from "../src/tool-service.js"

function branchCount(schema: Record<string, unknown>): number {
  const branches = schema.anyOf ?? schema.oneOf
  return Array.isArray(branches) ? branches.reduce((count, branch) => count + branchCount(branch), 0) : 1
}

test("union tool wire schemas and invocation agree on branches, defaults and rejected inputs", async () => {
  for (const single of [false, true]) {
    const calls: Record<string, unknown>[] = []
    const operation = async (input: Record<string, unknown>) => {
      calls.push(input)
      return { connectionId: "DEV100" }
    }
    const service = { runAbapApplication: operation, readClassicObject: operation,
      writeClassicObject: operation, updateDdic: operation } as unknown as AbapToolService
    const server = createMcpServer(service, { apiVersion: "v1",
      ...(single ? resolveServeToolSelection("v1", undefined, "single") : {}) })
    const client = new Client({ name: "object-input-test", version: "1" })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await server.connect(b)
    await client.connect(a)
    try {
      const catalog = (await client.listTools()).tools
      const common = { systemId: "DEV100" }
      const cases: Array<[string, Record<string, unknown>[], number]> = [
        ["sap.execution.preview", [
          { kind: "class", className: "ZCL_TEST" }, { kind: "snippet", code: "WRITE 'OK'." },
          { kind: "program", programName: "ZTEST" }
        ], 3],
        ["sap.classic.read", [
          { kind: "gui_status", programName: "ZTEST" },
          { kind: "screen", programName: "ZTEST", screenNumber: "100" }
        ], 2],
        ["sap.classic.write", [
          { kind: "gui_status", operation: "upsert", programName: "ZTEST", definition: "fixture" },
          { kind: "screen", operation: "upsert", programName: "ZTEST", screenNumber: "100", definition: "fixture" },
          { kind: "screen", operation: "delete", programName: "ZTEST", screenNumber: "100" }
        ], 3],
        ["sap.ddic.update", [
          { kind: "table", name: "ZTEST", source: "fixture", expectedFingerprint: "0".repeat(64) },
          { kind: "structure", name: "ZTEST", source: "fixture", expectedFingerprint: "0".repeat(64) },
          { kind: "domain", name: "ZTEST", expectedFingerprint: "0".repeat(64), properties: {
            typeInformation: { datatype: "CHAR", length: 10, decimals: 0 },
            outputInformation: { length: 10, signExists: false, lowercase: false, ampmFormat: false }
          } },
          { kind: "data_element", name: "ZTEST", expectedFingerprint: "0".repeat(64), properties: {
            typeName: "ZDOMAIN", dataType: "CHAR", dataTypeLength: 10,
            fieldLabels: { shortFieldLabel: "Test", mediumFieldLabel: "Test", longFieldLabel: "Test", headingFieldLabel: "Test" }
          } }
        ], 4]
      ]
      for (const [name, inputs, branches] of cases) {
        let schema = catalog.find(tool => tool.name === name)?.inputSchema
        let capability: { schemaHash: string; risk: string } | undefined
        if (single) {
          const described = await client.callTool({ name: "sap", arguments: { name: "describe", arguments: { name } } })
          const data = described.structuredContent as { data: { capability: typeof capability & { inputSchema: NonNullable<typeof schema> } } }
          capability = data.data.capability
          schema = data.data.capability.inputSchema
        }
        assert.ok(schema, name)
        assert.equal(branchCount(schema), branches, name)
        const validate = new AjvJsonSchemaValidator().getValidator(schema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0])
        const invoke = (args: Record<string, unknown>) => client.callTool(single
          ? { name: "sap", arguments: { name, schemaHash: capability?.schemaHash, risk: capability?.risk, arguments: args } }
          : { name, arguments: args })
        for (const input of inputs) {
          const args = { ...common, ...input }
          assert.equal(validate(args).valid, true, `${name}: ${JSON.stringify(input)}`)
          const before = calls.length
          assert.notEqual((await invoke(args)).isError, true, name)
          assert.equal(calls.length, before + 1, name)
          if (name === "sap.execution.preview" && input.kind === "class") assert.equal(calls.at(-1)?.profiling, false)
          if (name === "sap.classic.write" || name === "sap.ddic.update") assert.equal(calls.at(-1)?.activate, false)
          const missingBranchField = { ...args } as Record<string, unknown>
          delete missingBranchField[Object.keys(input).at(-1)!]
          for (const invalid of [{ ...args, unexpected: true }, { ...args, kind: "invalid" }, { kind: input.kind }, missingBranchField]) {
            assert.equal(validate(invalid).valid, false, name)
            const beforeInvalid = calls.length
            assert.equal((await invoke(invalid)).isError, true, name)
            assert.equal(calls.length, beforeInvalid, name)
          }
          if (name === "sap.classic.write" && input.kind === "gui_status") {
            const failed = await invoke(missingBranchField)
            assert.match(JSON.stringify(failed), /definition/)
            assert.doesNotMatch(JSON.stringify(failed), /screenNumber/)
          }
        }
      }
    } finally { await client.close(); await server.close() }
  }
})
