import assert from "node:assert/strict"
import test from "node:test"
import {
  ABAP_MCP_TOOLSETS,
  ABAP_FS_MCP_TOOL_NAMES,
  IMPLEMENTED_TOOL_NAMES,
  toolsForToolsets
} from "../src/compat/abap-fs-tools.js"

test("implementation preserves all 42 ABAP FS MCP tools and adds extension capabilities", () => {
  assert.equal(ABAP_FS_MCP_TOOL_NAMES.length, 42)
  assert.equal(new Set(ABAP_FS_MCP_TOOL_NAMES).size, 42)
  assert.equal(IMPLEMENTED_TOOL_NAMES.length, 52)
  assert.equal(new Set(IMPLEMENTED_TOOL_NAMES).size, 52)
  assert.ok(ABAP_FS_MCP_TOOL_NAMES.every(name => IMPLEMENTED_TOOL_NAMES.includes(name)))
})

test("static toolsets cover the full tool surface without changing all", () => {
  const grouped = new Set(Object.values(ABAP_MCP_TOOLSETS).flat())
  assert.deepEqual([...grouped].sort(), [...IMPLEMENTED_TOOL_NAMES].sort())
  assert.equal(
    Object.values(ABAP_MCP_TOOLSETS).flat().filter(
      name => name === "get_sap_capabilities"
    ).length,
    1
  )
  assert.equal(
    ABAP_MCP_TOOLSETS.write.filter(name => name === "run_abap_application").length,
    1
  )
  assert.deepEqual(
    [...toolsForToolsets(["core"])].sort(),
    [...ABAP_MCP_TOOLSETS.core].sort()
  )
  assert.equal(toolsForToolsets(["all"]).size, 52)
})
