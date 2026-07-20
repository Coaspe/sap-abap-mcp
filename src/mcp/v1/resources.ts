import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js"
import { installV1CompletionRouter } from "./completion-router.js"
import {
  parseAdtResourceUri,
  parseCapabilityResourceUri
} from "./resource-uri.js"
import { installV1ResourceRegistry } from "./resource-registry.js"
import { sanitizeV1Message } from "./result.js"
import type { V1ReadService } from "./service.js"

async function readCapabilityResource(
  value: string,
  service: V1ReadService
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
  service: V1ReadService
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

export function registerV1Resources(
  server: McpServer,
  service: V1ReadService
): void {
  const completionRouter = installV1CompletionRouter(server)
  installV1ResourceRegistry(server, completionRouter)

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
