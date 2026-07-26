import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../dist/src/mcp/v1/migration-catalog.js"
import { V1_RESOURCE_NAMES } from "../dist/src/mcp/v1/toolsets.js"
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const expectedToolNames = [...V1_IMPLEMENTED_TOOL_NAMES].sort()
const configDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-v1-smoke-"))
const client = new Client({ name: "sap-abap-mcp-v1-smoke", version: "1.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "src", "index.js"), "serve"],
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
  assert.deepEqual(listedTools.map(tool => tool.name).sort(), expectedToolNames)
  const [fixedResources, resourceTemplates] = await Promise.all([
    client.listResources(),
    client.listResourceTemplates()
  ])
  assert.deepEqual([
    ...fixedResources.resources.map(resource => resource.name),
    ...resourceTemplates.resourceTemplates.map(resource => resource.name)
  ].sort(), [...V1_RESOURCE_NAMES].sort())

  const systems = await client.callTool({ name: "sap.system.list", arguments: {} })
  assert.deepEqual(systems.structuredContent?.data, { systems: [] })
  process.stdout.write(
    `default stdio smoke passed: ${expectedToolNames.length} v1 tools, ${V1_RESOURCE_NAMES.length} Resources, 0 systems\n`
  )
} finally {
  await client.close().catch(() => undefined)
  await rm(configDirectory, { recursive: true })
}
