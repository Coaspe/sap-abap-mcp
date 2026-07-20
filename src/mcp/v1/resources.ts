import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  parseAdtResourceUri,
  parseCapabilityResourceUri
} from "./resource-uri.js"
import type { V1ReadService } from "./service.js"

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
    async uri => {
      const { systemId, canonicalUri } = parseCapabilityResourceUri(uri.toString())
      const result = await service.getSapCapabilities(systemId, undefined, true)
      const { connectionId: _connectionId, ...data } = result
      return {
        contents: [{
          uri: canonicalUri,
          mimeType: "application/json",
          text: JSON.stringify(data)
        }]
      }
    }
  )

  server.registerResource(
    "sap-adt-source",
    new ResourceTemplate("adt://{system}/{+adtPath}", { list: undefined }),
    {
      title: "SAP ABAP Source",
      description: "Complete active ABAP source for one canonical ADT resource.",
      mimeType: "text/x-abap"
    },
    async uri => {
      const { systemId, adtPath, canonicalUri } = parseAdtResourceUri(uri.toString())
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
  )
}
