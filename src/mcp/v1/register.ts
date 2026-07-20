import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { V1_MIGRATION_CATALOG } from "./migration-catalog.js"
import { registerV1RepositoryTools } from "./repository-tools.js"
import { registerV1Resources } from "./resources.js"
import type { V1ReadService } from "./service.js"
import { registerV1SourceTools } from "./source-tools.js"
import {
  registerV1SystemTools,
  V1_READ_ONLY_ANNOTATIONS
} from "./system-tools.js"

export { V1_READ_ONLY_ANNOTATIONS }

export interface V1RegistrationOptions {
  enabledV0Tools?: ReadonlySet<string>
}

export function isV1ToolEnabled(
  v1ToolName: string,
  enabledV0Tools?: ReadonlySet<string>
): boolean {
  if (!enabledV0Tools) return true
  for (const [v0ToolName, entry] of Object.entries(V1_MIGRATION_CATALOG)) {
    if (entry.targets.some(target =>
      target === v1ToolName && !target.includes("://") && !target.includes("*")
    )) {
      return enabledV0Tools.has(v0ToolName)
    }
  }
  return false
}

export function registerV1Tools(
  server: McpServer,
  service: V1ReadService,
  options: V1RegistrationOptions = {}
): void {
  const systemToolNames = [
    "sap.system.list",
    "sap.system.inspect",
    "sap.system.capabilities"
  ].filter(name =>
    isV1ToolEnabled(name, options.enabledV0Tools)
  )
  registerV1SystemTools(server, service, new Set(systemToolNames))
  const repositoryToolNames = ["sap.repository.search"].filter(name =>
    isV1ToolEnabled(name, options.enabledV0Tools)
  )
  registerV1RepositoryTools(server, service, new Set(repositoryToolNames))
  const sourceToolNames = ["sap.source.read"].filter(name =>
    isV1ToolEnabled(name, options.enabledV0Tools)
  )
  registerV1SourceTools(server, service, new Set(sourceToolNames))
  registerV1Resources(server, service)
}
