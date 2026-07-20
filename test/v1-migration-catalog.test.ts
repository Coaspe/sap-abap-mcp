import assert from "node:assert/strict"
import test from "node:test"
import { IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import { V1_MIGRATION_CATALOG } from "../src/mcp/v1/migration-catalog.js"

test("every advertised v0 tool has one migration disposition", () => {
  assert.deepEqual(
    Object.keys(V1_MIGRATION_CATALOG).sort(),
    [...IMPLEMENTED_TOOL_NAMES].sort()
  )
})

test("the first slice has one unambiguous v0 source per v1 tool", () => {
  const inverse = Object.entries(V1_MIGRATION_CATALOG).flatMap(([v0, entry]) =>
    entry.disposition === "first_slice"
      ? entry.targets
          .filter(target => target.startsWith("sap."))
          .map(target => [target, v0] as const)
      : []
  )
  assert.deepEqual(Object.fromEntries(inverse), {
    "sap.system.list": "get_connected_systems",
    "sap.system.inspect": "get_sap_system_info",
    "sap.system.capabilities": "get_sap_capabilities",
    "sap.repository.search": "search_abap_objects",
    "sap.source.read": "get_abap_object_lines"
  })
})
