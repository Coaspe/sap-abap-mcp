import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../dist/src/mcp/v1/migration-catalog.js"
import { v1ToolsForToolsets } from "../dist/src/mcp/v1/toolsets.js"
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const coreNames = v1ToolsForToolsets(["core"])
const expectedToolNames = V1_IMPLEMENTED_TOOL_NAMES
  .filter(name => coreNames.has(name))
  .sort()
const configDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-v1-smoke-"))
const client = new Client({ name: "sap-abap-mcp-v1-smoke", version: "1.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "src", "index.js"), "serve", "--api-version", "v1"],
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

  const systems = await client.callTool({ name: "sap.system.list", arguments: {} })
  assert.deepEqual(systems.structuredContent?.data, { systems: [] })
  process.stdout.write(
    `v1 stdio smoke passed: ${expectedToolNames.length} core tools, 0 systems\n`
  )
} finally {
  await client.close().catch(() => undefined)
  await rm(configDirectory, { recursive: true })
}
