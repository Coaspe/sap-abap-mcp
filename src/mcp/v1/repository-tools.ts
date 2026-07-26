import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ABAP_OBJECT_TYPES } from "../../abap-object-types.js"
import { V1_SUCCESS_SHAPE } from "./contracts.js"
import {
  normalizeV1SystemId,
  toAdtResourceUri
} from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"
import type { V1ReadService } from "./service.js"
import { V1_READ_ONLY_ANNOTATIONS } from "./system-tools.js"

const REPOSITORY_SEARCH_TOOL = "sap.repository.search"

const repositorySearchDataSchema = z.object({
  pattern: z.string(),
  objects: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string().optional(),
    packageName: z.string().optional(),
    resourceUri: z.string()
  }))
})

const repositorySearchOutputSchema = z.object({
  ...V1_SUCCESS_SHAPE,
  data: repositorySearchDataSchema
})

export function registerV1RepositoryTools(
  server: McpServer,
  service: V1ReadService,
  enabledTools?: ReadonlySet<string>
): void {
  if (enabledTools && !enabledTools.has(REPOSITORY_SEARCH_TOOL)) return

  server.registerTool(
    REPOSITORY_SEARCH_TOOL,
    {
      title: "Search SAP Repository",
      description: "Search ABAP repository objects by name pattern and object type.",
      inputSchema: {
        systemId: z.string().min(1),
        pattern: z.string().min(1),
        objectTypes: z.array(z.enum(ABAP_OBJECT_TYPES)).min(1),
        limit: z.number().int().min(1).max(500).default(20)
      },
      outputSchema: repositorySearchOutputSchema,
      annotations: V1_READ_ONLY_ANNOTATIONS
    },
    async ({ systemId, pattern, objectTypes, limit }) => runV1Tool(async () => {
      const normalizedSystemId = normalizeV1SystemId(systemId)
      const result = await service.searchObjects({
        connectionId: normalizedSystemId,
        pattern,
        types: objectTypes,
        maxResults: limit
      })
      const objects = result.objects.map(object => ({
        name: object.name,
        type: object.type,
        ...(object.description !== undefined
          ? { description: object.description }
          : {}),
        ...(object.packageName !== undefined
          ? { packageName: object.packageName }
          : {}),
        resourceUri: toAdtResourceUri(normalizedSystemId, object.uri)
      }))
      return v1Success({ pattern: result.pattern, objects }, {
        systemId: normalizedSystemId,
        page: { returned: objects.length }
      })
    })
  )
}
