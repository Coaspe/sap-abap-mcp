import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ABAP_OBJECT_TYPES } from "../../abap-object-types.js"
import { AppError } from "../../errors.js"
import { V1_SUCCESS_SHAPE } from "./contracts.js"
import {
  normalizeV1SystemId,
  parseAdtResourceUri,
  toAdtResourceUri
} from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"
import type { V1ReadService } from "./service.js"
import { V1_READ_ONLY_ANNOTATIONS } from "./system-tools.js"

const SOURCE_READ_TOOL = "sap.source.read"

const sourceReadDataSchema = z.object({
  object: z.object({ name: z.string(), type: z.string() }).optional(),
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

const sourceReadInputSchema = z.object({
  systemId: z.string().min(1),
  objectName: z.string().min(1).optional(),
  resourceUri: z.string().min(1).optional(),
  objectType: z.enum(ABAP_OBJECT_TYPES).optional(),
  methodName: z.string().min(1).optional(),
  startLine: z.number().int().min(1).default(1),
  lineCount: z.number().int().min(1).max(5000).default(50)
}).strict().refine(
  input => (input.objectName === undefined) !== (input.resourceUri === undefined),
  { message: "Provide exactly one of objectName or resourceUri" }
)

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
      description: "Read a bounded active ABAP source range, one class method, or one canonical ADT Resource.",
      inputSchema: sourceReadInputSchema,
      outputSchema: sourceReadOutputSchema,
      annotations: V1_READ_ONLY_ANNOTATIONS
    },
    async input => runV1Tool(async () => {
      const normalizedSystemId = normalizeV1SystemId(input.systemId)
      if (input.resourceUri) {
        const parsed = parseAdtResourceUri(input.resourceUri)
        if (parsed.systemId !== normalizedSystemId) {
          throw new AppError(
            "SAP_VALIDATION_FAILED",
            "The Resource system must match systemId"
          )
        }
        const result = await service.getObjectByUri({
          connectionId: normalizedSystemId,
          uri: parsed.adtPath,
          startLine: input.startLine - 1,
          lineCount: input.lineCount
        })
        const data = {
          resourceUri: parsed.canonicalUri,
          startLine: result.startLine + 1,
          endLine: result.endLine,
          totalLines: result.totalLines,
          truncated: result.truncated,
          nextLine: result.nextLine === null ? null : result.nextLine + 1,
          code: result.code
        }
        return v1Success(data, {
          systemId: normalizedSystemId,
          resourceLinks: [{
            uri: parsed.canonicalUri,
            name: "ABAP Source",
            description: "Read complete active ABAP source for this canonical Resource.",
            mimeType: "text/x-abap"
          }]
        })
      }
      const result = await service.getObjectLines({
        connectionId: normalizedSystemId,
        objectName: input.objectName!,
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
