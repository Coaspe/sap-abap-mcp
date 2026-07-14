import assert from "node:assert/strict"
import test from "node:test"
import {
  ABAP_MCP_TOOLSETS,
  ABAP_FS_MCP_TOOL_NAMES,
  ABAP_FS_UPSTREAM_MCP_TOOL_NAMES,
  IMPLEMENTED_TOOL_NAMES,
  toolsForToolsets
} from "../src/compat/abap-fs-tools.js"
import { readAbapFsDocumentation } from "../src/compat/abap-fs-documentation.js"

test("implementation advertises the strict-compatible headless subset without the host-only tool", () => {
  assert.equal(ABAP_FS_UPSTREAM_MCP_TOOL_NAMES.length, 43)
  assert.equal(ABAP_FS_MCP_TOOL_NAMES.length, 42)
  assert.equal(new Set(ABAP_FS_UPSTREAM_MCP_TOOL_NAMES).size, 43)
  assert.equal(new Set(ABAP_FS_MCP_TOOL_NAMES).size, 42)
  const localNames = new Set<string>(ABAP_FS_MCP_TOOL_NAMES)
  assert.deepEqual(
    ABAP_FS_UPSTREAM_MCP_TOOL_NAMES.filter((name: string) => !localNames.has(name)),
    ["manage_subagents"]
  )
  assert.equal((ABAP_FS_UPSTREAM_MCP_TOOL_NAMES as readonly string[]).includes("manage_subagents"), true)
  assert.equal((IMPLEMENTED_TOOL_NAMES as readonly string[]).includes("manage_subagents"), false)
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

test("bundled documentation states exact parity, verification, and runtime boundaries", () => {
  const documentation = readAbapFsDocumentation({
    action: "get_documentation",
    startLine: 1,
    lineCount: 5000
  })
  assert.equal("content" in documentation, true)
  const content = "content" in documentation ? documentation.content : ""

  for (const line of [
    "Pinned upstream MCP tools: 43",
    "Strict-compatible local tools: 42",
    "Omitted upstream tool: manage_subagents (requires the VS Code agent host)",
    "Total locally advertised tools: 52",
    "SAP-dependent parity features are implemented but remain live-unverified until a selected connection succeeds.",
    "ABAP REPL requires ZCL_ABAP_REPL and SICF /sap/bc/z_abap_repl.",
    "Generic report/program-console execution is not implemented."
  ]) {
    assert.ok(content.split("\n").includes(line), `missing documentation line: ${line}`)
  }

  const statusSearch = readAbapFsDocumentation({
    action: "search_documentation",
    searchQuery: "live-unverified",
    startLine: 1,
    lineCount: 1
  })
  assert.equal("matchCount" in statusSearch ? statusSearch.matchCount : 0, 1)
  assert.equal(
    "matches" in statusSearch ? statusSearch.matches[0]?.line : undefined,
    "SAP-dependent parity features are implemented but remain live-unverified until a selected connection succeeds."
  )

  const groupTools = (group: string) => {
    const afterHeading = content.split(`### ${group}\n\n`)[1] ?? ""
    return afterHeading.split("\n\n")[0]?.split("\n").map(line => line.slice(2)) ?? []
  }
  assert.deepEqual(groupTools("Connection and discovery"), [
    "get_connected_systems", "get_sap_system_info", "get_sap_capabilities", "adt_discovery_export"
  ])
  assert.deepEqual(groupTools("Repository read and navigation"), [
    "search_abap_objects", "get_abap_object_lines", "search_abap_object_lines",
    "get_abap_object_info", "get_batch_lines", "get_object_by_uri", "find_where_used",
    "get_abap_object_url", "get_abap_object_workspace_uri", "open_object", "inspect_abap_code"
  ])
  assert.deepEqual(groupTools("Runtime operations"), [
    "run_abap_application", "abap_debug_session", "abap_debug_breakpoint", "abap_debug_step",
    "abap_debug_variable", "abap_debug_stack", "abap_debug_status", "analyze_abap_dumps",
    "analyze_abap_traces", "manage_heartbeat"
  ])
})
