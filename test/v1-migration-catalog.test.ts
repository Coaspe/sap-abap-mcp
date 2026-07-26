import assert from "node:assert/strict"
import test from "node:test"
import { IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import {
  V1_IMPLEMENTED_TOOL_NAMES,
  V1_MIGRATION_CATALOG,
  V1_TOOL_NAMES
} from "../src/mcp/v1/migration-catalog.js"
import { V1_MCP_TOOLSETS } from "../src/mcp/v1/toolsets.js"

const WATCH_TOOL_NAMES = [
  "sap.ops.watch.status",
  "sap.ops.watch.start",
  "sap.ops.watch.stop",
  "sap.ops.watch.trigger",
  "sap.ops.watch.history",
  "sap.ops.watch.task.add",
  "sap.ops.watch.task.remove",
  "sap.ops.watch.task.update",
  "sap.ops.watch.task.enable",
  "sap.ops.watch.task.disable",
  "sap.ops.watch.task.list",
  "sap.ops.watch.watchlist.read"
] as const

test("every advertised v0 tool has one migration disposition", () => {
  assert.deepEqual(
    Object.keys(V1_MIGRATION_CATALOG).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
})

test("the complete catalog has exact targets without wildcard names", () => {
  const targetReferences = Object.values(V1_MIGRATION_CATALOG)
    .flatMap(entry => entry.targets)
    .filter(target => target.startsWith("sap."))

  assert.equal(targetReferences.length, 117)
  assert.equal(V1_TOOL_NAMES.length, 115)
  assert.equal(new Set(V1_TOOL_NAMES).size, 115)
  assert.ok(V1_TOOL_NAMES.every(name => /^sap\.[a-z0-9_.]+$/.test(name)))
  assert.ok(Object.values(V1_MIGRATION_CATALOG).every(entry =>
    entry.targets.every(target => !target.includes("*"))
  ))
})

test("watch and cached ATC mappings are exact parity targets", () => {
  assert.deepEqual(
    V1_MIGRATION_CATALOG.manage_heartbeat.targets,
    WATCH_TOOL_NAMES
  )
  assert.deepEqual(V1_MIGRATION_CATALOG.get_atc_decorations, {
    targets: ["sap.quality.atc.cached"],
    disposition: "implemented"
  })
})

test("implemented target accounting matches the completed v1 registrars", () => {
  assert.deepEqual(
    [...V1_IMPLEMENTED_TOOL_NAMES].sort(),
    [
      ...V1_MCP_TOOLSETS.core,
      ...V1_MCP_TOOLSETS.write,
      ...V1_MCP_TOOLSETS.analysis,
      ...V1_MCP_TOOLSETS.debug,
      ...V1_MCP_TOOLSETS.operations,
      ...V1_MCP_TOOLSETS.artifacts
    ].sort()
  )
})
