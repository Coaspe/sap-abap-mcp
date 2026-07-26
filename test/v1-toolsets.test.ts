import assert from "node:assert/strict"
import test from "node:test"
import { V1_IMPLEMENTED_TOOL_NAMES, V1_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import {
  V1_IMPLEMENTED_RESOURCE_NAMES,
  V1_MCP_TOOLSETS,
  V1_RESOURCE_NAMES,
  V1_RESOURCE_TOOLSETS,
  v1ResourcesForToolsets,
  v1ToolsForToolsets
} from "../src/mcp/v1/toolsets.js"

test("v1 primary toolsets cover all 115 names exactly once", () => {
  const counts = Object.fromEntries(
    Object.entries(V1_MCP_TOOLSETS).map(([name, tools]) => [name, tools.length])
  )
  assert.deepEqual(counts, {
    core: 20,
    write: 24,
    analysis: 30,
    debug: 10,
    operations: 24,
    artifacts: 7
  })

  const grouped = Object.values(V1_MCP_TOOLSETS).flat()
  assert.equal(grouped.length, 115)
  assert.equal(new Set(grouped).size, 115)
  assert.deepEqual([...grouped].sort(), [...V1_TOOL_NAMES].sort())
  assert.deepEqual([...v1ToolsForToolsets(["all"])].sort(), [...V1_TOOL_NAMES].sort())
  assert.ok(V1_IMPLEMENTED_TOOL_NAMES.every(name => V1_TOOL_NAMES.includes(name)))
})

test("v1 Resource ownership is exact and evidence is available to every set", () => {
  assert.deepEqual(V1_RESOURCE_NAMES, [
    "sap-adt-source",
    "sap-capability-evidence",
    "sap-docs-compat",
    "sap-docs-data-query",
    "sap-docs-mermaid",
    "sap-evidence",
    "sap-transport"
  ])
  assert.deepEqual(V1_IMPLEMENTED_RESOURCE_NAMES, [
    "sap-adt-source",
    "sap-capability-evidence",
    "sap-docs-compat",
    "sap-docs-data-query",
    "sap-docs-mermaid",
    "sap-evidence",
    "sap-transport"
  ])
  assert.ok(Object.values(V1_RESOURCE_TOOLSETS).every(names =>
    names.includes("sap-evidence")
  ))
  assert.deepEqual(
    [...v1ResourcesForToolsets(["all"])].sort(),
    [...V1_RESOURCE_NAMES].sort()
  )
})
