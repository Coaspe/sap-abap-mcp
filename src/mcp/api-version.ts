import { AppError } from "../errors.js"

export const MCP_API_VERSIONS = ["v0", "v1"] as const
type PublicMcpApiVersion = typeof MCP_API_VERSIONS[number]
export type McpApiVersion = PublicMcpApiVersion | "all"

export function parseMcpApiVersion(value?: string): McpApiVersion {
  if (value === undefined) return "v1"
  if (MCP_API_VERSIONS.includes(value as PublicMcpApiVersion)) {
    return value as PublicMcpApiVersion
  }
  throw new AppError("INVALID_API_VERSION", `Unknown API version: ${value}`, {
    available: MCP_API_VERSIONS
  })
}
