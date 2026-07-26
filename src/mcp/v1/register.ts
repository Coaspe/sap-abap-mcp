import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { AbapToolService } from "../../tool-service.js"
import { registerV1AnalysisTools } from "./analysis-tools.js"
import { registerV1ArtifactTools } from "./artifact-tools.js"
import { registerV1CoreTools } from "./core-tools.js"
import { registerV1DebugTools } from "./debug-tools.js"
import { V1EvidenceStore } from "./evidence-store.js"
import { registerV1OperationsTools } from "./operations-tools.js"
import { registerV1RepositoryTools } from "./repository-tools.js"
import { registerV1Resources } from "./resources.js"
import { registerV1SourceTools } from "./source-tools.js"
import {
  registerV1SystemTools,
  V1_READ_ONLY_ANNOTATIONS
} from "./system-tools.js"
import type { V1ResourceName } from "./toolsets.js"
import { registerV1WriteTools } from "./write-tools.js"

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
  service: AbapToolService,
  options: V1RegistrationOptions = {}
): void {
  const evidenceStore = new V1EvidenceStore()
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
  registerV1CoreTools(server, service, options.enabledTools)
  registerV1WriteTools(server, service, options.enabledTools)
  registerV1AnalysisTools(server, service, options.enabledTools)
  registerV1DebugTools(server, service, options.enabledTools)
  registerV1OperationsTools(server, service, options.enabledTools)
  registerV1ArtifactTools(server, service, evidenceStore, options.enabledTools)
  registerV1Resources(server, service, evidenceStore, options.enabledResources)
}
