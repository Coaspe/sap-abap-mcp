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
    "The unversioned `serve` is the complete current v1 surface.",
    "With no `--toolsets`, all six v1 toolsets are enabled.",
    "The complete v1 surface contains 115 callable tools and seven Resources.",
    "All 53 v0 capabilities remain available through `--api-version v0`.",
    "Live SAP acceptance remains a separate gate",
    "The combined v0 + v1 surface is internal to automated parity tests and is not accepted by the CLI."
  ]) {
    assert.ok(guide.includes(statement), statement)
  }
  assert.deepEqual(
    [...guide.matchAll(/^npx @coaspe\/sap-abap-mcp@latest serve.*$/gm)]
      .map(match => match[0]),
    [
      "npx @coaspe/sap-abap-mcp@latest serve",
      "npx @coaspe/sap-abap-mcp@latest serve --toolsets core,analysis",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version v0",
    ]
  )
  for (const toolset of ["core", "write", "analysis", "debug", "operations", "artifacts"]) {
    assert.match(guide, new RegExp(`\\b${toolset}\\b`))
  }
  assert.doesNotMatch(guide, /only implemented handlers are advertised/i)
})

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
    mcpb.server.mcp_config.args,
    registryArguments.map(argument => argument.value)
  ]) {
    assertUnversionedServeArgs(args)
  }
})

test("README documents current defaults, strict TMP ownership, and connection diagnosis", async () => {
  const readme = await readFile("README.md", "utf8")

  for (const statement of [
    "Normal clients should omit both `--api-version` and `--toolsets`.",
    "Existing SAP objects may be used for reads, searches, and analysis.",
    "A candidate becomes `RUN_OWNED` only after both a successful create receipt and an immediate exact read-back",
    "docs/live-sap-v1-115-tool-tmp-test-prompt.ko.md",
    "`-32000` (`ConnectionClosed`)"
  ]) {
    assert.ok(readme.includes(statement), statement)
  }
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

test("Windows live prompt covers all tools with strict current-run TMP ownership", async () => {
  const guide = await readFile("docs/live-sap-b4d-windows-local-test.ko.md", "utf8")
  const prompt = await readFile(
    "docs/live-sap-v1-115-tool-tmp-test-prompt.ko.md",
    "utf8"
  )

  assert.ok(guide.includes(
    'claude mcp add --transport stdio --scope user sap-abap-b4d-local -- node "C:\\src\\sap-abap-mcp-v1\\dist\\src\\index.js" serve --profile B4D'
  ))
  assert.doesNotMatch(guide, /--api-version all|168개/)
  for (const statement of [
    "115행 ledger",
    "create receipt",
    "immediate exact read-back",
    "RUN_OWNED",
    "SKIP-SCOPE",
    "SKIP-PREREQUISITE",
    "EXPECTED-ERROR",
    "`$TMP`",
    "이름이나 검색 결과만으로 소유권을 증명할 수 없다."
  ]) {
    assert.ok(prompt.includes(statement), statement)
  }
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
