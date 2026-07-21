import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js"
import { MERMAID_DIAGRAM_TYPES, type MermaidDiagramType } from "../../mermaid-tools.js"
import type { AbapToolService } from "../../tool-service.js"
import { installV1CompletionRouter } from "./completion-router.js"
import type { V1EvidenceStore } from "./evidence-store.js"
import {
  parseAdtResourceUri,
  parseCapabilityResourceUri,
  parseDocsResourceUri,
  parseTransportResourceUri
} from "./resource-uri.js"
import { installV1ResourceRegistry } from "./resource-registry.js"
import { sanitizeV1Message } from "./result.js"
import type { V1ResourceName } from "./toolsets.js"

async function readCapabilityResource(
  value: string,
  service: AbapToolService
): Promise<ReadResourceResult> {
  const { systemId, canonicalUri } = parseCapabilityResourceUri(value)
  const result = await service.getSapCapabilities(systemId, undefined, true)
  const { connectionId: _connectionId, ...data } = result
  const sanitizedData = {
    ...data,
    systemMetadata: {
      ...data.systemMetadata,
      warnings: data.systemMetadata.warnings.map(sanitizeV1Message)
    },
    capabilities: data.capabilities.map(capability => {
      const evidence = (capability as typeof capability & {
        evidence?: string[]
      }).evidence
      return {
        ...capability,
        ...(evidence === undefined
          ? {}
          : { evidence: evidence.map(sanitizeV1Message) })
      }
    })
  }
  return {
    contents: [{
      uri: canonicalUri,
      mimeType: "application/json",
      text: JSON.stringify(sanitizedData)
    }]
  }
}

async function readAdtResource(
  value: string,
  service: AbapToolService
): Promise<ReadResourceResult> {
  const { systemId, adtPath, canonicalUri } = parseAdtResourceUri(value)
  const result = await service.getObjectByUri({
    connectionId: systemId,
    uri: adtPath,
    startLine: 0,
    lineCount: Number.MAX_SAFE_INTEGER
  })
  return {
    contents: [{
      uri: canonicalUri,
      mimeType: "text/x-abap",
      text: result.code,
      _meta: {
        startLine: result.startLine,
        endLine: result.endLine,
        totalLines: result.totalLines,
        truncated: result.truncated,
        nextLine: result.nextLine
      }
    }]
  }
}

async function readDataQueryDocumentation(
  value: string,
  service: AbapToolService
): Promise<ReadResourceResult> {
  const parsed = parseDocsResourceUri(value)
  if (parsed.family !== "data-query") {
    throw new TypeError("Expected data-query documentation URI")
  }
  return {
    contents: [{
      uri: parsed.canonicalUri,
      mimeType: "application/json",
      text: JSON.stringify(service.getAbapSqlSyntax())
    }]
  }
}

async function readCompatDocumentation(
  value: string,
  service: AbapToolService
): Promise<ReadResourceResult> {
  const parsed = parseDocsResourceUri(value)
  if (parsed.family !== "compat") {
    throw new TypeError("Expected compatibility documentation URI")
  }
  if (parsed.document !== "documentation" && parsed.document !== "settings") {
    throw new TypeError("Compatibility document must be documentation or settings")
  }
  const result = service.getAbapFsDocumentation({
    action: parsed.document === "settings" ? "get_settings" : "get_documentation",
    startLine: 1,
    lineCount: 200
  })
  const page = result as {
    source: string
    content: string
    startLine: number
    endLine: number
    totalLines: number
  }
  return {
    contents: [{
      uri: parsed.canonicalUri,
      mimeType: "text/markdown",
      text: page.content,
      _meta: {
        source: page.source,
        startLine: page.startLine,
        endLine: page.endLine,
        totalLines: page.totalLines
      }
    }]
  }
}

async function readMermaidDocumentation(
  value: string,
  service: AbapToolService
): Promise<ReadResourceResult> {
  const parsed = parseDocsResourceUri(value)
  if (parsed.family !== "mermaid") {
    throw new TypeError("Expected Mermaid documentation URI")
  }
  const document = parsed.document
  if (
    document !== "all" &&
    !MERMAID_DIAGRAM_TYPES.includes(document as MermaidDiagramType)
  ) {
    throw new TypeError("Unsupported Mermaid documentation name")
  }
  return {
    contents: [{
      uri: parsed.canonicalUri,
      mimeType: "application/json",
      text: JSON.stringify(service.getMermaidDocumentation(
        document as MermaidDiagramType | "all",
        true
      ))
    }]
  }
}

async function readEvidenceResource(
  value: string,
  evidenceStore: V1EvidenceStore
): Promise<ReadResourceResult> {
  const result = evidenceStore.read(value)
  return {
    contents: [{
      uri: result.uri,
      mimeType: "application/json",
      text: result.text,
      _meta: { expiresAt: result.expiresAt }
    }]
  }
}

async function readTransportResource(
  value: string,
  service: AbapToolService
): Promise<ReadResourceResult> {
  const parsed = parseTransportResourceUri(value)
  const result = await service.manageTransportRequests({
    action: "get_transport_details",
    connectionId: parsed.systemId,
    transportNumber: parsed.transport,
    startIndex: 0,
    maxResults: 500,
    includeObjects: true
  })
  return {
    contents: [{
      uri: parsed.canonicalUri,
      mimeType: "application/json",
      text: JSON.stringify(result)
    }]
  }
}

function resourceEnabled(
  name: V1ResourceName,
  enabled?: ReadonlySet<V1ResourceName>
): boolean {
  return enabled === undefined || enabled.has(name)
}

export function registerV1Resources(
  server: McpServer,
  service: AbapToolService,
  evidenceStore: V1EvidenceStore,
  enabled?: ReadonlySet<V1ResourceName>
): void {
  const capabilityEnabled = resourceEnabled("sap-capability-evidence", enabled)
  const sourceEnabled = resourceEnabled("sap-adt-source", enabled)
  const compatEnabled = resourceEnabled("sap-docs-compat", enabled)
  const dataQueryEnabled = resourceEnabled("sap-docs-data-query", enabled)
  const mermaidEnabled = resourceEnabled("sap-docs-mermaid", enabled)
  const evidenceEnabled = resourceEnabled("sap-evidence", enabled)
  const transportEnabled = resourceEnabled("sap-transport", enabled)
  if (
    !capabilityEnabled && !sourceEnabled && !compatEnabled &&
    !dataQueryEnabled && !mermaidEnabled && !evidenceEnabled && !transportEnabled
  ) return

  const completionRouter = installV1CompletionRouter(server)
  installV1ResourceRegistry(server, completionRouter)

  if (capabilityEnabled) {
    server.registerResource(
      "sap-capability-evidence",
      new ResourceTemplate("sap-capability://{system}", { list: undefined }),
      {
        title: "SAP Capability Evidence",
        description: "Complete capability discovery evidence for one SAP system.",
        mimeType: "application/json"
      },
      uri => readCapabilityResource(uri.toString(), service)
    )
  }

  if (sourceEnabled) {
    server.registerResource(
      "sap-adt-source",
      new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
      {
        title: "SAP ABAP Source",
        description: "Complete active ABAP source for one canonical ADT resource.",
        mimeType: "text/x-abap"
      },
      uri => readAdtResource(uri.toString(), service)
    )
  }

  if (compatEnabled) {
    server.registerResource(
      "sap-docs-compat",
      new ResourceTemplate("sap-docs://compat/{document}", { list: undefined }),
      {
        title: "SAP ABAP MCP Compatibility Documentation",
        description: "Bundled compatibility or settings documentation.",
        mimeType: "text/markdown"
      },
      uri => readCompatDocumentation(uri.toString(), service)
    )
  }

  if (dataQueryEnabled) {
    server.registerResource(
      "sap-docs-data-query",
      "sap-docs://data-query",
      {
        title: "SAP Data Query Documentation",
        description: "Safe SAP ADT data-preview SQL rules and examples.",
        mimeType: "application/json"
      },
      uri => readDataQueryDocumentation(uri.toString(), service)
    )
  }

  if (mermaidEnabled) {
    server.registerResource(
      "sap-docs-mermaid",
      new ResourceTemplate("sap-docs://mermaid/{document}", { list: undefined }),
      {
        title: "Mermaid Documentation",
        description: "Bundled Mermaid syntax for one supported diagram type.",
        mimeType: "application/json"
      },
      uri => readMermaidDocumentation(uri.toString(), service)
    )
  }

  if (evidenceEnabled) {
    server.registerResource(
      "sap-evidence",
      new ResourceTemplate("sap-evidence://{runId}/{artifact}", { list: undefined }),
      {
        title: "SAP Session Evidence",
        description: "Bounded, redacted, session-owned artifact evidence.",
        mimeType: "application/json"
      },
      uri => readEvidenceResource(uri.toString(), evidenceStore)
    )
  }

  if (transportEnabled) {
    server.registerResource(
      "sap-transport",
      new ResourceTemplate("sap-transport://{system}/{transport}", { list: undefined }),
      {
        title: "SAP Transport Evidence",
        description: "Current details and objects for one SAP transport.",
        mimeType: "application/json"
      },
      uri => readTransportResource(uri.toString(), service)
    )
  }

}
