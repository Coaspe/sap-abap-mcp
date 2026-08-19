import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import type { ToolsetName } from "../../compat/abap-fs-tools.js"
import type { V1PresetName } from "./presets.js"

interface SurfaceBudget {
  maxTools: number
  maxSchemaBytes: number
}

export const V1_MAX_TOOL_SCHEMA_BYTES = 8 * 1024

export const V1_SURFACE_BUDGETS: Record<ToolsetName, SurfaceBudget> = {
  core: { maxTools: 24, maxSchemaBytes: 36 * 1024 },
  write: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  analysis: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  debug: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  operations: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  artifacts: { maxTools: 32, maxSchemaBytes: 64 * 1024 },
  all: { maxTools: 120, maxSchemaBytes: 384 * 1024 }
}

export const V1_PRESET_SURFACE_BUDGETS: Record<V1PresetName, SurfaceBudget> = {
  compact: { maxTools: 12, maxSchemaBytes: 24 * 1024 },
  development: { maxTools: 34, maxSchemaBytes: 56 * 1024 },
  assurance: { maxTools: 15, maxSchemaBytes: 28 * 1024 }
}

export function measureToolSurface(tools: readonly Tool[]) {
  const largestTools = tools.map(tool => ({
    name: tool.name,
    bytes: Buffer.byteLength(JSON.stringify(tool), "utf8")
  })).sort((left, right) => right.bytes - left.bytes)
  const schemaBytes = Buffer.byteLength(JSON.stringify(tools), "utf8")

  return {
    toolCount: tools.length,
    schemaBytes,
    estimatedTokensCeilBytesDiv4: Math.ceil(schemaBytes / 4),
    largestTools: largestTools.slice(0, 10)
  }
}
