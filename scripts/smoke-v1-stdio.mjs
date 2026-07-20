import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
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
  const expectedToolNames = [
    "sap.repository.search",
    "sap.source.read",
    "sap.system.capabilities",
    "sap.system.inspect",
    "sap.system.list"
  ]
  const listedTools = (await client.listTools()).tools
  assert.deepEqual(listedTools.map(tool => tool.name).sort(), expectedToolNames)

  const systems = await client.callTool({ name: "sap.system.list", arguments: {} })
  assert.deepEqual(systems.structuredContent?.data, { systems: [] })
  process.stdout.write("v1 stdio smoke passed: 5 tools, 0 systems\n")
} finally {
  await client.close().catch(() => undefined)
  await rm(configDirectory, { recursive: true })
}
