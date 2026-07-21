import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { advertisedTools, stableToolSurface } from "./helpers/mcp-surface.js"

async function committedV0Surface(): Promise<unknown> {
  return JSON.parse(
    await readFile("test/fixtures/v0-tool-surface.json", "utf8")
  )
}

test("unversioned MCP retains the committed v0 tool surface", async () => {
  assert.deepEqual(
    stableToolSurface(await advertisedTools()),
    await committedV0Surface()
  )
})

test("explicit v0 MCP is identical to the committed unversioned surface", async () => {
  assert.deepEqual(
    stableToolSurface(await advertisedTools({ apiVersion: "v0" })),
    await committedV0Surface()
  )
})
