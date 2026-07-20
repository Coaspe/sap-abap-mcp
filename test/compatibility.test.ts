import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
  assert.equal(IMPLEMENTED_TOOL_NAMES.length, 53)
  assert.equal(new Set(IMPLEMENTED_TOOL_NAMES).size, 53)
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
  assert.ok(
    Object.values(ABAP_MCP_TOOLSETS).every(toolset =>
      toolset.includes("read_deferred_result")
    )
  )
  assert.deepEqual(
    [...toolsForToolsets(["core"])].sort(),
    [...ABAP_MCP_TOOLSETS.core].sort()
  )
  assert.equal(toolsForToolsets(["all"]).size, 53)
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
    "Total locally advertised tools: 53",
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
  assert.deepEqual(groupTools("MCP result retrieval"), ["read_deferred_result"])
  assert.deepEqual(groupTools("Connection and discovery"), [
    "get_connected_systems", "get_sap_system_info", "get_sap_capabilities", "adt_discovery_export"
  ])
  assert.deepEqual(groupTools("Repository read and navigation"), [
    "search_abap_objects", "get_abap_object_lines", "search_abap_object_lines",
    "get_abap_object_info", "get_batch_lines", "get_object_by_uri", "find_where_used",
    "get_abap_object_url", "get_abap_object_workspace_uri", "open_object", "inspect_abap_code",
    "get_abap_dependency_graph", "compare_abap_systems"
  ])
  assert.deepEqual(groupTools("Runtime operations"), [
    "run_abap_application", "run_sap_transaction", "abap_debug_session", "abap_debug_breakpoint",
    "abap_debug_step", "abap_debug_variable", "abap_debug_stack", "abap_debug_status",
    "analyze_abap_dumps", "analyze_abap_traces", "manage_heartbeat"
  ])

  const toolSection = content.split("## Tool groups\n\n")[1]?.split("## Recommended workflow")[0] ?? ""
  const documentedTools = [...toolSection.matchAll(/^- (.+)$/gm)].map(match => match[1]!)
  assert.equal(documentedTools.length, 53)
  assert.equal(new Set(documentedTools).size, 53)
  assert.deepEqual([...documentedTools].sort(), [...IMPLEMENTED_TOOL_NAMES].sort())
})

test("published guides preserve current counts and live acceptance safety boundaries", () => {
  const readme = readFileSync("README.md", "utf8")
  const acceptance = readFileSync("docs/live-sap-acceptance.md", "utf8")
  const matrix = readFileSync("docs/compatibility-matrix.md", "utf8")
  const evidenceSchema = JSON.parse(
    readFileSync("docs/compatibility-evidence.schema.json", "utf8")
  )

  assert.match(readme, /complete 53-tool schema/)
  assert.doesNotMatch(readme, /50-tool|eight grouped|eight extension|all 42 MCP tools/)
  assert.match(acceptance, /"status": "<supported\|unsupported\|unverified>"/)
  assert.match(acceptance, /"scope": "live-sap"/)
  assert.match(acceptance, /compatibility-evidence\.schema\.json/)
  assert.match(matrix, /does not prove support for a particular SAP release/)
  assert.match(matrix, /Sanitized live evidence committed to this repository \| Not supplied/)
  assert.match(matrix, /npm run benchmark:surface/)
  assert.equal(evidenceSchema.properties.schemaVersion.const, "1.0")
  assert.deepEqual(evidenceSchema.properties.status.enum, [
    "supported", "unsupported", "unverified"
  ])
  assert.equal(
    evidenceSchema.allOf[0].then.properties.status.const,
    "unverified"
  )
  assert.match(
    acceptance,
    /Choose `supported` only after the relevant operation succeeds and a fresh `get_sap_capabilities` read for the same connection reports `supported`\./
  )
  assert.match(
    acceptance,
    /`get_sap_system_info\.environment` is the configured MCP profile environment, not an independently detected SAP production flag\./
  )
  assert.match(acceptance, /returned `environment` is `production`/)
  assert.doesNotMatch(acceptance, /SAP reports a production system/)
  assert.match(acceptance, /Create `CLAS\/OC` without `source`/)
  assert.match(acceptance, /inside a method body/)
  assert.match(acceptance, /`completion_element` at the referenced method token/)

  for (const tool of [
    "create_object_programmatically", "abap_activate", "run_abap_application",
    "inspect_abap_code", "refactor_abap_code"
  ]) {
    assert.match(acceptance, new RegExp("arguments (?:object )?for `" + tool + "`"))
  }
  assert.match(acceptance, /`MCP_CLASS_RUNNER_OK`/)
  assert.doesNotMatch(acceptance, /MCP_CLASSRUN_OK/)
  assert.match(acceptance, /The execute response's `capabilityStatusAtExecution` is the pre-call status/)
  assert.match(acceptance, /`success` is `true`, `error` is empty, and output contains `MCP_REPL_OK`/)

  const replSection = acceptance.split("## 5. Check and run the fixed ABAP REPL contract")[1]
    ?.split("## 6. Inspect detailed semantic information")[0] ?? ""
  assert.doesNotMatch(
    replSection,
    /`capabilityStatusAtExecution` is the pre-call status and may be `unverified`/
  )
  assert.match(
    replSection,
    /a successful execute should report `capabilityStatusAtExecution` as `supported`/
  )
  assert.match(
    replSection,
    /fresh `get_sap_capabilities` read remains the authoritative recorded evidence/
  )

  const classesCleanup = acceptance.indexOf("Delete the three classes first")
  const bdefCleanup = acceptance.indexOf("Next, delete the `BDEF/BDO` behavior definition")
  const ddlsCleanup = acceptance.indexOf("Only after the behavior definition is gone, delete the `DDLS`")
  assert.ok(classesCleanup >= 0 && classesCleanup < bdefCleanup && bdefCleanup < ddlsCleanup)
  assert.match(acceptance, /Reinspect the dedicated transport at the end/)
  assert.match(acceptance, /acceptance cannot pass until the final transport state is recorded/)
})
