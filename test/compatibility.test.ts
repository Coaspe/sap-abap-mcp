import assert from "node:assert/strict"
import test from "node:test"
import {
  ABAP_MCP_TOOLSETS,
  ABAP_FS_MCP_TOOL_NAMES,
  IMPLEMENTED_TOOL_NAMES,
  toolsForToolsets
} from "../src/compat/abap-fs-tools.js"

test("ABAP FS compatibility manifest tracks 42 unique MCP tools", () => {
  assert.equal(ABAP_FS_MCP_TOOL_NAMES.length, 42)
  assert.equal(new Set(ABAP_FS_MCP_TOOL_NAMES).size, 42)
  assert.equal(IMPLEMENTED_TOOL_NAMES.length, 42)
  assert.equal(new Set(IMPLEMENTED_TOOL_NAMES).size, 42)
  assert.deepEqual(
    [...IMPLEMENTED_TOOL_NAMES].sort(),
    [...ABAP_FS_MCP_TOOL_NAMES].sort()
  )
})

test("static toolsets cover the full tool surface without changing all", () => {
  const grouped = new Set(Object.values(ABAP_MCP_TOOLSETS).flat())
  assert.deepEqual([...grouped].sort(), [...IMPLEMENTED_TOOL_NAMES].sort())
  assert.deepEqual(
    [...toolsForToolsets(["core"])].sort(),
    [...ABAP_MCP_TOOLSETS.core].sort()
  )
  assert.equal(toolsForToolsets(["all"]).size, 42)
})
