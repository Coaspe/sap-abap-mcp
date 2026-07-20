import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { toolsForToolsets } from "../src/compat/abap-fs-tools.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

const V1_TOOL_NAMES = [
  "sap.system.list",
  "sap.system.inspect",
  "sap.system.capabilities",
  "sap.repository.search",
  "sap.source.read"
] as const

test("v1 migration guide documents the opt-in read-only contract", async () => {
  const guide = await readFile("docs/v1-migration.md", "utf8")

  assert.match(guide, /unversioned `serve` remains v0 through 1\.x/i)
  assert.deepEqual(
    [...guide.matchAll(/^npx @coaspe\/sap-abap-mcp@latest serve.*$/gm)]
      .map(match => match[0]),
    [
      "npx @coaspe/sap-abap-mcp@latest serve",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version v1",
      "npx @coaspe/sap-abap-mcp@latest serve --api-version all"
    ]
  )
  for (const toolName of V1_TOOL_NAMES) {
    assert.match(guide, new RegExp(toolName.replaceAll(".", "\\.")))
  }
  assert.match(guide, /read-only/i)
})

test("published launch defaults stay on v0", async () => {
  for (const file of [
    "plugins/sap-abap-mcp/.mcp.json",
    "mcpb/manifest.json",
    "server.json"
  ]) {
    const manifest = await readFile(file, "utf8")
    assert.doesNotMatch(manifest, /"--api-version"/)
  }
})

test("v1 surfaces stay within the documented schema budget and counts", async () => {
  const enabledTools = toolsForToolsets(["all"])
  const v1Tools = await advertisedTools({ apiVersion: "v1", enabledTools })
  const allTools = await advertisedTools({ apiVersion: "all", enabledTools })
  const v1SchemaBytes = Buffer.byteLength(JSON.stringify(v1Tools), "utf8")

  assert.ok(v1SchemaBytes < 24 * 1024)
  assert.equal(v1Tools.length, 5)
  assert.equal(allTools.length, 58)
})
