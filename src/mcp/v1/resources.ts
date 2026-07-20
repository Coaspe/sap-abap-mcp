import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  ErrorCode,
  McpError,
  ReadResourceRequestSchema,
  type ReadResourceResult
} from "@modelcontextprotocol/sdk/types.js"
import { AppError } from "../../errors.js"
import {
  assertRawV1ResourceUri,
  parseAdtResourceUri,
  parseCapabilityResourceUri
} from "./resource-uri.js"
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

function resourceError(error: unknown): McpError {
  const message = sanitizeV1Message(
    error instanceof Error ? error.message : String(error)
  ) || "Resource read failed"
  if (error instanceof McpError) return new McpError(error.code, message)
  if (error instanceof AppError && error.code === "INVALID_ADT_URI") {
    return new McpError(ErrorCode.InvalidParams, message)
  }
  return new McpError(ErrorCode.InternalError, message)
}

async function readV1Resource(
  value: string,
  service: V1ReadService
): Promise<ReadResourceResult> {
  try {
    assertRawV1ResourceUri(value)
    const separator = value.indexOf(":")
    const scheme = separator < 0 ? "" : value.slice(0, separator).toLowerCase()
    if (scheme === "sap-capability") {
      return await readCapabilityResource(value, service)
    }
    if (scheme === "adt") return await readAdtResource(value, service)
    throw new AppError(
      "INVALID_ADT_URI",
      "Resource URI does not match a registered v1 template"
    )
  } catch (error) {
    throw resourceError(error)
  }
}

export function registerV1Resources(
  server: McpServer,
  service: V1ReadService
): void {
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

  server.server.setRequestHandler(
    ReadResourceRequestSchema,
    request => readV1Resource(request.params.uri, service)
  )
}
