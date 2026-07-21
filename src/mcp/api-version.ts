import { AppError } from "../errors.js"

export const MCP_API_VERSIONS = ["v0", "v1", "all"] as const
export type McpApiVersion = typeof MCP_API_VERSIONS[number]

export function parseMcpApiVersion(value?: string): McpApiVersion {
  if (value === undefined) return "v1"
  if (MCP_API_VERSIONS.includes(value as McpApiVersion)) {
    return value as McpApiVersion
  }
  throw new AppError("INVALID_API_VERSION", `Unknown API version: ${value}`, {
    available: MCP_API_VERSIONS
  })
}
