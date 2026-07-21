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

test("v1 migration guide documents the complete local contract and live boundary", async () => {
  const guide = await readFile("docs/v1-migration.md", "utf8")

  for (const statement of [
    "The unversioned `serve` remains the complete v0 compatibility surface.",
    "Explicit v1 mode defaults to the `core` toolset.",
    "The complete v1 surface contains 113 callable tools and seven Resources.",
    "All 53 v0 capabilities remain available through the unchanged v0 compatibility surface.",
    "Live SAP acceptance remains a separate gate",
    "`--api-version all` is reserved for migration conformance because it exposes duplicate capabilities."
  ]) {
    assert.ok(guide.includes(statement), statement)
  }
  assert.deepEqual(
    [...guide.matchAll(/^npx @coaspe\/sap-abap-mcp@latest serve.*$/gm)]
      .map(match => match[0]),
    [
      "npx @coaspe/sap-abap-mcp@latest serve",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version v1",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version v1 --toolsets all",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version all",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version v1 --toolsets core,analysis"
    ]
  )
  for (const toolset of ["core", "write", "analysis", "debug", "operations", "artifacts"]) {
    assert.match(guide, new RegExp(`\\b${toolset}\\b`))
  }
  assert.doesNotMatch(guide, /only implemented handlers are advertised/i)
})

test("published launch defaults stay on v0", async () => {
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
    mcpb.server.mcp_config.args,
    registryArguments.map(argument => argument.value)
  ]) {
    assertUnversionedServeArgs(args)
  }
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
