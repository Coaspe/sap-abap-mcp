import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { advertisedTools, stableToolSurface } from "./helpers/mcp-surface.js"

test("unversioned MCP retains the committed v0 tool surface", async () => {
  const expected = JSON.parse(
    await readFile("test/fixtures/v0-tool-surface.json", "utf8")
  )
  assert.deepEqual(stableToolSurface(await advertisedTools()), expected)
})
