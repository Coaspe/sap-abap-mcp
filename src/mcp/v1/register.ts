import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerV1RepositoryTools } from "./repository-tools.js"
import { registerV1Resources } from "./resources.js"
import type { V1ReadService } from "./service.js"
import { registerV1SourceTools } from "./source-tools.js"
import {
  registerV1SystemTools,
  V1_READ_ONLY_ANNOTATIONS
} from "./system-tools.js"
import type { V1ResourceName } from "./toolsets.js"

export { V1_READ_ONLY_ANNOTATIONS }

export interface V1RegistrationOptions {
  enabledTools?: ReadonlySet<string>
  enabledResources?: ReadonlySet<V1ResourceName>
}

export function isV1ToolEnabled(
  v1ToolName: string,
  enabledTools?: ReadonlySet<string>
): boolean {
  return enabledTools === undefined || enabledTools.has(v1ToolName)
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
    isV1ToolEnabled(name, options.enabledTools)
  )
  registerV1SystemTools(server, service, new Set(systemToolNames))
  const repositoryToolNames = ["sap.repository.search"].filter(name =>
    isV1ToolEnabled(name, options.enabledTools)
  )
  registerV1RepositoryTools(server, service, new Set(repositoryToolNames))
  const sourceToolNames = ["sap.source.read"].filter(name =>
    isV1ToolEnabled(name, options.enabledTools)
  )
  registerV1SourceTools(server, service, new Set(sourceToolNames))
  registerV1Resources(server, service, options.enabledResources)
}
