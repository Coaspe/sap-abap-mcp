import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { advertisedTools, stableToolSurface } from "./helpers/mcp-surface.js"

async function committedV0Surface(): Promise<unknown> {
  return JSON.parse(
    await readFile("test/fixtures/v0-tool-surface.json", "utf8")
  )
}

async function committedV0Order(): Promise<unknown> {
  return JSON.parse(
    await readFile("test/fixtures/v0-tool-order.json", "utf8")
  )
}

test("unversioned MCP retains the committed v0 tool surface", async () => {
  const tools = await advertisedTools()
  assert.deepEqual(
    stableToolSurface(tools),
    await committedV0Surface()
  )
  assert.deepEqual(tools.map(tool => tool.name), await committedV0Order())
})

test("explicit v0 MCP is identical to the committed unversioned surface", async () => {
  const tools = await advertisedTools({ apiVersion: "v0" })
  assert.deepEqual(
    stableToolSurface(tools),
    await committedV0Surface()
  )
  assert.deepEqual(tools.map(tool => tool.name), await committedV0Order())
})
