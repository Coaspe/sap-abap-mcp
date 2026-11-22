import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import {
  IMPLEMENTED_TOOL_NAMES,
  toolsForToolsets
} from "../src/compat/abap-fs-tools.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import { v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import { advertisedTools } from "./helpers/mcp-surface.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"

function assertUnversionedServeArgs(args: readonly string[]): void {
  assert.equal(
    args.includes("--api-version"),
    false,
    "launch args must not include --api-version"
  )
  assert.equal(
    args.at(-1),
    "serve",
    "launch args must end with unversioned serve"
  )
}

test("published unversioned launches use the current v1 default", async () => {
  const plugin = JSON.parse(
    await readFile("plugins/sap-abap-mcp/.mcp.json", "utf8")
  ) as { mcpServers: { "sap-abap": { args: string[] } } }
  const mcpb = JSON.parse(
    await readFile("mcpb/manifest.json", "utf8")
  ) as { server: { mcp_config: { args: string[] } } }
  const registry = JSON.parse(
    await readFile("server.json", "utf8")
  ) as {
    packages: Array<{
      packageArguments: Array<{ type: string, value: string }>
    }>
  }
  const registryPackage = registry.packages[0]
  assert.ok(registryPackage)
  const registryArguments = registryPackage.packageArguments
  assert.ok(registryArguments.every(argument => argument.type === "positional"))

  for (const args of [
    plugin.mcpServers["sap-abap"].args,
    mcpb.server.mcp_config.args.filter(value => value !== "--onboard-if-empty"),
    registryArguments.map(argument => argument.value)
  ]) {
    assertUnversionedServeArgs(args)
  }
})

test("MCPB catalog matches the unversioned v1 runtime", async () => {
  const manifest = JSON.parse(
    await readFile("mcpb/manifest.json", "utf8")
  ) as {
    tools_generated: boolean
    tools: Array<{ name: string; description: string }>
  }
  const tools = await advertisedTools(resolveServeToolSelection("v1", undefined, "minimal"))

  assert.equal(manifest.tools_generated, false)
  assert.deepEqual(
    manifest.tools,
    tools.map(tool => ({
      name: tool.name,
      description: tool.description
    })).sort((left, right) => left.name.localeCompare(right.name))
  )
})

test("README documents the unversioned default", async () => {
  const readme = await readFile("README.md", "utf8")
  assert.ok(readme.includes("Normal clients should omit both `--api-version` and `--toolsets`."))
  assert.doesNotMatch(readme, /--api-version all|168 tools/)
})

test("published launch guard rejects versioned or post-serve arguments", () => {
  assert.throws(
    () => assertUnversionedServeArgs(["serve", "--profile", "DEV"]),
    /unversioned serve/
  )
  assert.throws(
    () => assertUnversionedServeArgs(["serve", "--api-version", "v1"]),
    /--api-version/
  )
})

test("published package includes the v1 stdio smoke implementation", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    files: string[]
  }

  assert.ok(packageJson.files.includes("scripts/smoke-v1-stdio.mjs"))
})

test("v1 surfaces stay within the documented counts", async () => {
  const enabledV0Tools = toolsForToolsets(["all"])
  const enabledV1Tools = v1ToolsForToolsets(["all"])
  const v1Tools = await advertisedTools({ apiVersion: "v1", enabledV1Tools })
  const allTools = await advertisedTools({
    apiVersion: "all",
    enabledV0Tools,
    enabledV1Tools
  })
  assert.equal(v1Tools.length, V1_IMPLEMENTED_TOOL_NAMES.length)
  assert.equal(
    allTools.length,
    IMPLEMENTED_TOOL_NAMES.length + V1_IMPLEMENTED_TOOL_NAMES.length
  )
})
