import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../dist/src/mcp/v1/migration-catalog.js"
import { ADAPTIVE_V1_TOOL_NAMES } from "../dist/src/mcp/v1/adaptive-tools.js"
import { V1_MCP_PRESETS } from "../dist/src/mcp/v1/presets.js"
import { V1_RESOURCE_NAMES } from "../dist/src/mcp/v1/toolsets.js"
import { V1_WORKFLOW_PROMPTS } from "../dist/src/mcp/v1/workflow-prompts.js"
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const expectedToolNames = [...V1_IMPLEMENTED_TOOL_NAMES].sort()
const configDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-v1-smoke-"))
async function smoke(mode) {
  const full = mode === "full"
  const minimal = mode === "default" || mode === "minimal"
  const single = mode === "single"
  const client = new Client({ name: "sap-abap-mcp-v1-smoke", version: "1.0.0" })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "src", "index.js"), "serve", ...(full ? ["--toolsets", "all"] : mode === "default" ? [] : ["--preset", mode])],
    cwd: root,
    env: {
      ...getDefaultEnvironment(),
      SAP_ABAP_MCP_HOME: configDirectory
    },
    stderr: "pipe"
  })

  try {
    await client.connect(transport)
    const listedTools = (await client.listTools()).tools
    assert.deepEqual(listedTools.map(tool => tool.name).sort(), single ? ["sap"] : full
      ? expectedToolNames
      : [...(minimal ? [] : V1_MCP_PRESETS.compact), ...ADAPTIVE_V1_TOOL_NAMES].sort())
    const [fixedResources, resourceTemplates] = await Promise.all([
      client.listResources(),
      client.listResourceTemplates()
    ])
    assert.deepEqual([
      ...fixedResources.resources.map(resource => resource.name),
      ...resourceTemplates.resourceTemplates.map(resource => resource.name)
    ].sort(), [...V1_RESOURCE_NAMES].sort())

    if (!full) {
      const catalog = []
      let cursor
      do {
        const page = await client.callTool({
          name: single ? "sap" : "sap.capability.search",
          arguments: single ? { name: "search", arguments: { limit: 50, ...(cursor ? { cursor } : {}) } } : { limit: 50, ...(cursor ? { cursor } : {}) }
        })
        assert.notEqual(page.isError, true)
        catalog.push(...page.structuredContent.data.tools.map(tool => tool.name))
        cursor = page.structuredContent.data.nextCursor
      } while (cursor)
      assert.deepEqual(catalog.sort(), expectedToolNames)
      const described = await client.callTool({
        name: single ? "sap" : "sap.capability.describe", arguments: single ? { name: "describe", arguments: { name: "sap.system.list" } } : { name: "sap.system.list" }
      })
      const invoked = await client.callTool({
        name: single ? "sap" : "sap.capability.invoke_read",
        arguments: { name: "sap.system.list", schemaHash: described.structuredContent.data.capability.schemaHash, ...(single ? { risk: "read" } : {}) }
      })
      assert.deepEqual(invoked.structuredContent.data, { systems: [] })
    }
    if (!minimal && !single) {
      const systems = await client.callTool({ name: "sap.system.list", arguments: {} })
      assert.deepEqual(systems.structuredContent?.data, { systems: [] })
    }
    const prompts = (await client.listPrompts()).prompts
    assert.deepEqual(
      prompts.map(prompt => prompt.name).sort(),
      V1_WORKFLOW_PROMPTS.map(prompt => prompt.name).sort()
    )
    const explanation = await client.getPrompt({
      name: "sap-explain-object",
      arguments: { systemId: "DEV100", target: "ZCL_DEMO" }
    })
    assert.equal(explanation.messages[0]?.content.type, "text")
    process.stdout.write(
      `${mode === "default" ? "default minimal" : mode} stdio smoke passed: ${listedTools.length} v1 tools, ${V1_RESOURCE_NAMES.length} Resources, ${prompts.length} prompts, 0 systems\n`
    )
  } finally {
    await client.close().catch(() => undefined)
  }
}

try {
  for (const mode of ["default", "adaptive", "full", "minimal", "single"]) await smoke(mode)
} finally {
  await rm(configDirectory, { recursive: true })
}
