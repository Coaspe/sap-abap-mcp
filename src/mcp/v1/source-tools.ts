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

const SOURCE_READ_TOOL = "sap.source.read"

const sourceReadDataSchema = z.object({
  object: z.object({ name: z.string(), type: z.string() }),
  resourceUri: z.string(),
  methodName: z.string().optional(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().nonnegative(),
  methodEndLine: z.number().int().positive().optional(),
  totalLines: z.number().int().nonnegative().optional(),
  truncated: z.boolean(),
  nextLine: z.number().int().positive().nullable(),
  code: z.string()
})

const sourceReadOutputSchema = z.object({
  ...V1_SUCCESS_SHAPE,
  data: sourceReadDataSchema
})

export function registerV1SourceTools(
  server: McpServer,
  service: V1ReadService,
  enabledTools?: ReadonlySet<string>
): void {
  if (enabledTools && !enabledTools.has(SOURCE_READ_TOOL)) return

  server.registerTool(
    SOURCE_READ_TOOL,
    {
      title: "Read ABAP Source",
      description: "Read a bounded active ABAP source range or one class method.",
      inputSchema: {
        systemId: z.string().min(1),
        objectName: z.string().min(1),
        objectType: z.enum(ABAP_OBJECT_TYPES).optional(),
        methodName: z.string().min(1).optional(),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(5000).default(50)
      },
      outputSchema: sourceReadOutputSchema,
      annotations: V1_READ_ONLY_ANNOTATIONS
    },
    async input => runV1Tool(async () => {
      const normalizedSystemId = normalizeV1SystemId(input.systemId)
      const result = await service.getObjectLines({
        connectionId: normalizedSystemId,
        objectName: input.objectName,
        startLine: input.startLine,
        lineCount: input.lineCount,
        ...(input.objectType ? { objectType: input.objectType } : {}),
        ...(input.methodName ? { methodName: input.methodName } : {})
      })
      const {
        connectionId: _connectionId,
        sourceUri,
        ...source
      } = result
      const resourceUri = toAdtResourceUri(normalizedSystemId, sourceUri)
      return v1Success({
        object: source.object,
        resourceUri,
        ...(source.methodName !== undefined
          ? { methodName: source.methodName }
          : {}),
        startLine: source.startLine,
        endLine: source.endLine,
        ...(source.methodEndLine !== undefined
          ? { methodEndLine: source.methodEndLine }
          : {}),
        ...(source.totalLines !== undefined
          ? { totalLines: source.totalLines }
          : {}),
        truncated: source.truncated,
        nextLine: source.nextLine,
        code: source.code
      }, {
        systemId: normalizedSystemId,
        resourceLinks: [{
          uri: resourceUri,
          name: `ABAP Source ${source.object.name}`,
          description: `Read active ABAP source for ${source.object.name}.`,
          mimeType: "text/x-abap"
        }]
      })
    })
  )
}
