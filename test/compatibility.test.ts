import assert from "node:assert/strict"
import test from "node:test"
import {
  ABAP_FS_MCP_TOOL_NAMES,
  IMPLEMENTED_TOOL_NAMES
} from "../src/compat/abap-fs-tools.js"

test("ABAP FS compatibility manifest tracks 42 unique MCP tools", () => {
  assert.equal(ABAP_FS_MCP_TOOL_NAMES.length, 42)
  assert.equal(new Set(ABAP_FS_MCP_TOOL_NAMES).size, 42)
  for (const name of IMPLEMENTED_TOOL_NAMES) {
    assert.equal(ABAP_FS_MCP_TOOL_NAMES.includes(name), true)
  }
})
