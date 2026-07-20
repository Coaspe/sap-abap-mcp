import {
  McpServer,
  ResourceTemplate
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { parseCapabilityResourceUri } from "./resource-uri.js"
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
}
