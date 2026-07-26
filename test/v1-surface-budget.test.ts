import assert from "node:assert/strict"
import test from "node:test"
import type { ToolsetName } from "../src/compat/abap-fs-tools.js"
import { V1_IMPLEMENTED_TOOL_NAMES } from "../src/mcp/v1/migration-catalog.js"
import {
  V1_MAX_TOOL_SCHEMA_BYTES,
  V1_SURFACE_BUDGETS,
  measureToolSurface
} from "../src/mcp/v1/surface-budget.js"
import { v1ResourcesForToolsets, v1ToolsForToolsets } from "../src/mcp/v1/toolsets.js"
import { advertisedTools } from "./helpers/mcp-surface.js"

const TOOLSETS: ToolsetName[] = [
  "core", "write", "analysis", "debug", "operations", "artifacts", "all"
]

test("every implemented v1 surface stays inside its approved budget", async () => {
  for (const toolset of TOOLSETS) {
    const enabledV1Tools = v1ToolsForToolsets([toolset])
    const hasImplementedTool = V1_IMPLEMENTED_TOOL_NAMES.some(name =>
      enabledV1Tools.has(name)
    )
    const tools = hasImplementedTool
      ? await advertisedTools({
          apiVersion: "v1",
          enabledV1Tools,
          enabledV1Resources: v1ResourcesForToolsets([toolset])
        })
      : []
    const measurement = measureToolSurface(tools)
    const budget = V1_SURFACE_BUDGETS[toolset]
    assert.ok(measurement.toolCount <= budget.maxTools, toolset)
    assert.ok(measurement.schemaBytes <= budget.maxSchemaBytes, toolset)
    assert.ok(measurement.largestTools.every(tool =>
      tool.bytes <= V1_MAX_TOOL_SCHEMA_BYTES
    ), toolset)
  }
})

test("token proxy is the ceiling of minified bytes divided by four", async () => {
  const tools = await advertisedTools({
    apiVersion: "v1",
    enabledV1Tools: v1ToolsForToolsets(["core"])
  })
  const measurement = measureToolSurface(tools)
  assert.equal(
    measurement.estimatedTokensCeilBytesDiv4,
    Math.ceil(measurement.schemaBytes / 4)
  )
})
