import assert from "node:assert/strict"
import test from "node:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer } from "../src/mcp-server.js"
import { V1_MCP_TOOLSETS, v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import type { AbapToolService } from "../src/tool-service.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

interface RecordedCall {
  method: string
  input: unknown
}

function operation(calls: RecordedCall[], name: string) {
  return async (input: unknown) => {
    calls.push({ method: name, input })
    return { connectionId: "DEV100", method: name }
  }
}

function createWriteService() {
  const calls: RecordedCall[] = []
  const service = {
    runAbapApplication: operation(calls, "runAbapApplication"),
    manageAbapGit: operation(calls, "manageAbapGit"),
    async createTestInclude(className: string, connectionId: string, transport?: string) {
      calls.push({ method: "createTestInclude", input: { className, connectionId, transport } })
      return { connectionId: "DEV100", created: true }
    },
    manageRap: operation(calls, "manageRap"),
    refactorCode: operation(calls, "refactorCode"),
    createObjectProgrammatically: operation(calls, "createObjectProgrammatically"),
    activateObject: operation(calls, "activateObject"),
    replaceStringInObject: operation(calls, "replaceStringInObject"),
    manageTextElements: operation(calls, "manageTextElements"),
    manageTransportRequests: operation(calls, "manageTransportRequests"),
    manageVersions: operation(calls, "manageVersions")
  } as unknown as AbapToolService
  return { service, calls }
}

async function connectedClient(service: AbapToolService) {
  const server = createMcpServer(service, {
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["write"]),
    enabledV1Resources: new Set()
  })
  const client = new Client({ name: "v1-write-tools", version: "1.0.0" })
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

function firstText(result: CallToolResult): string {
  const content = result.content[0]
  assert.equal(content?.type, "text")
  if (content?.type !== "text") throw new Error("expected text content")
  return content.text
}

const RAP_CONTENT = {
  general: { description: "Demo" },
  businessObject: {
    dataModelEntity: { cdsName: "ZI_DEMO" },
    behavior: {
      implementationType: "managed",
      implementationClass: "ZBP_I_DEMO",
      draftTable: ""
    }
  },
  serviceProjection: { name: "ZC_DEMO" },
  businessService: {
    serviceDefinition: { name: "ZUI_DEMO" },
    serviceBinding: { name: "ZUI_DEMO_O2", bindingType: "ODATA" }
  }
}

test("the write toolset advertises 24 action-free v1 contracts", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["write"]),
    enabledV1Resources: new Set()
  })
  assert.deepEqual(
    tools.map(tool => tool.name).sort(),
    [...V1_MCP_TOOLSETS.write].sort()
  )
  assert.equal(tools.length, 24)
  for (const tool of tools) {
    assert.ok(tool.outputSchema, `${tool.name} outputSchema`)
    assert.equal("action" in (tool.inputSchema.properties ?? {}), false, tool.name)
    assert.equal(tool.annotations?.readOnlyHint, false, tool.name)
    assert.equal(typeof tool.annotations?.destructiveHint, "boolean", tool.name)
    assert.equal(typeof tool.annotations?.idempotentHint, "boolean", tool.name)
    assert.equal(tool.annotations?.openWorldHint, true, tool.name)
  }
  const transportCreate = tools.find(tool => tool.name === "sap.transport.create")
  assert.ok(transportCreate?.inputSchema.required?.includes("packageName"))
  const deleteExecute = tools.find(tool => tool.name === "sap.repository.delete.execute")
  assert.ok(deleteExecute?.description?.includes("delete"))
})

test("write adapters inject fixed service actions and preserve safety inputs", async t => {
  const { service, calls } = createWriteService()
  const connection = await connectedClient(service)
  t.after(() => connection.close())

  const invocations: Array<{ name: string; arguments: Record<string, unknown> }> = [
    {
      name: "sap.execution.execute",
      arguments: {
        systemId: " dev100 ",
        planId: "00000000-0000-4000-8000-000000000001",
        confirmation: "EXECUTE"
      }
    },
    {
      name: "sap.git.branch.switch",
      arguments: { systemId: "dev100", repositoryId: "REPO", branch: "feature", confirmation: "REPO" }
    },
    {
      name: "sap.git.create",
      arguments: {
        systemId: "dev100",
        repositoryUrl: "https://example.test/repo.git",
        packageName: "$TMP",
        confirmation: "$TMP:https://example.test/repo.git"
      }
    },
    {
      name: "sap.git.pull",
      arguments: { systemId: "dev100", repositoryId: "REPO", confirmation: "REPO" }
    },
    {
      name: "sap.git.push",
      arguments: {
        systemId: "dev100",
        repositoryId: "REPO",
        stageId: "STAGE",
        stageAll: true,
        comment: "Update",
        confirmation: "REPO"
      }
    },
    {
      name: "sap.git.stage",
      arguments: { systemId: "dev100", repositoryId: "REPO" }
    },
    {
      name: "sap.git.unlink",
      arguments: { systemId: "dev100", repositoryId: "REPO", confirmation: "REPO" }
    },
    {
      name: "sap.quality.test_include.create",
      arguments: { systemId: "dev100", className: "ZCL_DEMO", transport: "DEVK900001" }
    },
    {
      name: "sap.rap.binding.publish",
      arguments: { systemId: "dev100", serviceBindingName: "ZUI_DEMO_O2", confirmation: "ZUI_DEMO_O2" }
    },
    {
      name: "sap.rap.binding.unpublish",
      arguments: {
        systemId: "dev100",
        serviceBindingName: "ZUI_DEMO_O2",
        serviceName: "ZUI_DEMO",
        serviceVersion: "0001",
        confirmation: "ZUI_DEMO_O2:ZUI_DEMO:0001"
      }
    },
    {
      name: "sap.rap.generate",
      arguments: {
        systemId: "dev100",
        generatorId: "uiservice",
        referenceObjectName: "ZI_DEMO",
        packageName: "$TMP",
        content: RAP_CONTENT,
        confirmation: "uiservice:ZUI_DEMO_O2"
      }
    },
    {
      name: "sap.refactor.execute",
      arguments: { planId: "PLAN", confirmation: "CONFIRM" }
    },
    {
      name: "sap.repository.delete.execute",
      arguments: { planId: "DELETE-PLAN", confirmation: "ZDEMO" }
    },
    {
      name: "sap.repository.create",
      arguments: {
        systemId: "dev100",
        objectType: "PROG/P",
        name: "ZDEMO",
        description: "Demo",
        packageName: "$TMP"
      }
    },
    {
      name: "sap.source.activate",
      arguments: { systemId: "dev100", resourceUris: ["adt://dev100/sap/bc/adt/source"] }
    },
    {
      name: "sap.source.patch",
      arguments: {
        systemId: "dev100",
        fileUri: "adt://dev100/sap/bc/adt/source",
        oldString: "old",
        newString: "new",
        transport: "DEVK900001",
        activate: true
      }
    },
    {
      name: "sap.text_elements.write",
      arguments: {
        systemId: "dev100",
        objectName: "ZDEMO",
        objectType: "PROGRAM",
        writeMode: "update",
        textElements: [{ id: "001", text: "Hello" }],
        transport: "DEVK900001"
      }
    },
    {
      name: "sap.transport.create",
      arguments: { systemId: "dev100", description: "Demo", packageName: "ZPKG" }
    },
    {
      name: "sap.transport.delete",
      arguments: { systemId: "dev100", transportNumber: "DEVK900001", confirmation: "DEVK900001" }
    },
    {
      name: "sap.transport.object.add",
      arguments: {
        systemId: "dev100",
        transportNumber: "DEVK900001",
        pgmid: "R3TR",
        objectType: "CLAS",
        objectName: "ZCL_DEMO",
        confirmation: "DEVK900001:R3TR:CLAS:ZCL_DEMO"
      }
    },
    {
      name: "sap.transport.owner.set",
      arguments: {
        systemId: "dev100",
        transportNumber: "DEVK900001",
        targetUser: "DEVELOPER",
        confirmation: "DEVK900001:DEVELOPER"
      }
    },
    {
      name: "sap.transport.release",
      arguments: {
        systemId: "dev100",
        transportNumber: "DEVK900001",
        confirmation: "DEVK900001",
        ignoreLocks: true,
        ignoreAtc: true
      }
    },
    {
      name: "sap.transport.user.add",
      arguments: {
        systemId: "dev100",
        transportNumber: "DEVK900001",
        targetUser: "DEVELOPER",
        confirmation: "DEVK900001:DEVELOPER"
      }
    },
    {
      name: "sap.version.restore.execute",
      arguments: { systemId: "dev100", planId: "PLAN", confirmation: "ZDEMO:VERSION:1" }
    }
  ]

  for (const invocation of invocations) {
    const result = await connection.client.callTool(invocation) as CallToolResult
    assert.equal(result.isError, undefined, invocation.name)
    assert.deepEqual(result.structuredContent, JSON.parse(firstText(result)), invocation.name)
  }

  assert.equal(calls.length, 24)
  assert.deepEqual(calls.map(call => call.method), [
    "runAbapApplication",
    ...Array(6).fill("manageAbapGit"),
    "createTestInclude",
    ...Array(3).fill("manageRap"),
    ...Array(2).fill("refactorCode"),
    "createObjectProgrammatically",
    "activateObject",
    "replaceStringInObject",
    "manageTextElements",
    ...Array(6).fill("manageTransportRequests"),
    "manageVersions"
  ])
  assert.deepEqual(
    calls
      .map(call => call.input)
      .filter((input): input is Record<string, unknown> => Boolean(input) && typeof input === "object")
      .flatMap(input => typeof input.action === "string" ? [input.action] : []),
    [
      "execute",
      "switch_branch",
      "create_repository",
      "pull_repository",
      "push_repository",
      "stage_repository",
      "unlink_repository",
      "publish",
      "unpublish",
      "generate",
      "execute", "execute",
      "update",
      "create_transport",
      "delete_transport",
      "add_object",
      "set_owner",
      "release_transport",
      "add_user",
      "execute_restore"
    ]
  )
  for (const call of calls) {
    const input = call.input as Record<string, unknown>
    const systemId = input.connectionId
    if (systemId !== undefined) assert.equal(systemId, "DEV100", call.method)
  }
  assert.equal((calls[11]?.input as { expectedPlanKind: string }).expectedPlanKind, "refactor")
  assert.equal((calls[12]?.input as { expectedPlanKind: string }).expectedPlanKind, "delete")
  assert.equal((calls[21]?.input as { ignoreLocks: boolean }).ignoreLocks, true)
  assert.equal((calls[21]?.input as { ignoreAtc: boolean }).ignoreAtc, true)
  assert.equal((calls[4]?.input as { authorName?: string }).authorName, undefined)
  assert.equal((calls[4]?.input as { committerName?: string }).committerName, undefined)
})
