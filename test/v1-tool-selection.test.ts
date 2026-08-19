import assert from "node:assert/strict"
import test from "node:test"
import { ABAP_MCP_TOOLSETS, IMPLEMENTED_TOOL_NAMES } from "../src/compat/abap-fs-tools.js"
import { resolveServeToolSelection } from "../src/mcp/tool-selection.js"
import {
  V1_MCP_PRESETS,
  V1_PRESET_NAMES,
  V1_PRESET_RESOURCE_NAMES
} from "../src/mcp/v1/presets.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import { V1_MCP_TOOLSETS, V1_RESOURCE_NAMES } from "../src/mcp/v1/toolsets.js"

test("explicit v0 remains the unfiltered legacy surface", () => {
  assert.deepEqual(resolveServeToolSelection("v0"), {})
})

test("v1 defaults to all tools and all Resources", () => {
  const selection = resolveServeToolSelection("v1")
  assert.deepEqual(
    [...selection.enabledV1Tools!].sort(),
    Object.values(V1_MCP_TOOLSETS).flat().sort()
  )
  assert.deepEqual(
    [...selection.enabledV1Resources!].sort(),
    [...V1_RESOURCE_NAMES].sort()
  )
  assert.equal(selection.enabledV0Tools, undefined)
})

test("all API mode without toolsets remains unfiltered comparison", () => {
  assert.deepEqual(resolveServeToolSelection("all"), {})
})

test("explicit toolsets resolve independently for v0 and v1", () => {
  const selection = resolveServeToolSelection("all", ["write"])
  assert.deepEqual(
    [...selection.enabledV0Tools!].sort(),
    [...ABAP_MCP_TOOLSETS.write].sort()
  )
  assert.deepEqual(
    [...selection.enabledV1Tools!].sort(),
    [...V1_MCP_TOOLSETS.write].sort()
  )
})

test("explicit all selects both complete catalogs", () => {
  const selection = resolveServeToolSelection("all", ["all"])
  assert.equal(selection.enabledV0Tools!.size, IMPLEMENTED_TOOL_NAMES.length)
  assert.equal(selection.enabledV1Tools!.size, 115)
  assert.deepEqual(
    [...selection.enabledV1Resources!].sort(),
    [...V1_RESOURCE_NAMES].sort()
  )
})

test("presets select exact implemented v1 capabilities without duplicates", () => {
  for (const preset of V1_PRESET_NAMES) {
    const selection = resolveServeToolSelection("v1", undefined, preset)
    assert.deepEqual(
      [...selection.enabledV1Tools!].sort(),
      [...V1_MCP_PRESETS[preset]].sort()
    )
    assert.deepEqual(
      [...selection.enabledV1Resources!].sort(),
      [...V1_PRESET_RESOURCE_NAMES[preset]].sort()
    )
    assert.equal(selection.enabledV0Tools, undefined)
    assert.equal(selection.enabledV1Tools!.size, V1_MCP_PRESETS[preset].length)
    assert.ok(V1_MCP_PRESETS[preset].every(name =>
      V1_IMPLEMENTED_TOOL_NAMES.includes(name)
    ))
  }
})

test("presets reject legacy and combined API modes", () => {
  assert.throws(() => resolveServeToolSelection("v0", undefined, "compact"), {
    code: "PRESET_REQUIRES_V1"
  })
  assert.throws(() => resolveServeToolSelection("all", undefined, "compact"), {
    code: "PRESET_REQUIRES_V1"
  })
})
