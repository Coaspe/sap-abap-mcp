import {
  toolsForToolsets,
  type ToolsetName
} from "../compat/abap-fs-tools.js"
import type { McpApiVersion } from "./api-version.js"
import {
  v1ResourcesForToolsets,
  v1ToolsForToolsets,
  type V1ResourceName
} from "./v1/toolsets.js"

export interface ServeToolSelection {
  enabledV0Tools?: ReadonlySet<string>
  enabledV1Tools?: ReadonlySet<string>
  enabledV1Resources?: ReadonlySet<V1ResourceName>
}

export function resolveServeToolSelection(
  apiVersion: McpApiVersion,
  toolsets?: readonly ToolsetName[]
): ServeToolSelection {
  if (toolsets === undefined) {
    if (apiVersion !== "v1") return {}
    return {
      enabledV1Tools: v1ToolsForToolsets(["all"]),
      enabledV1Resources: v1ResourcesForToolsets(["all"])
    }
  }

  return {
    ...(apiVersion !== "v1"
      ? { enabledV0Tools: toolsForToolsets(toolsets) }
      : {}),
    ...(apiVersion !== "v0"
      ? {
          enabledV1Tools: v1ToolsForToolsets(toolsets),
          enabledV1Resources: v1ResourcesForToolsets(toolsets)
        }
      : {})
  }
}
