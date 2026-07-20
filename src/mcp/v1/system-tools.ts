import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { V1_SUCCESS_SHAPE } from "./contracts.js"
import { runV1Tool, v1Success } from "./result.js"
import type { V1ReadService } from "./service.js"

const SYSTEM_LIST_TOOL = "sap.system.list"
const SYSTEM_INSPECT_TOOL = "sap.system.inspect"

export const V1_READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations

const systemListDataSchema = z.object({
  systems: z.array(z.object({
    id: z.string().min(1),
    environment: z.enum(["development", "quality", "production"]),
    credentialAvailable: z.boolean()
  }))
})

const systemInspectDataSchema = z.object({
  client: z.string(),
  language: z.string(),
  environment: z.enum(["development", "quality", "production"]),
  sapRelease: z.string(),
  systemType: z.enum(["S/4HANA", "ECC", "Unknown"]),
  logicalSystem: z.string(),
  clientName: z.string(),
  timezone: z.object({
    name: z.string(),
    description: z.string(),
    utcOffset: z.string()
  }).nullable(),
  softwareComponents: z.array(z.object({
    component: z.string(),
    release: z.string(),
    extRelease: z.string(),
    componentType: z.string()
  })).optional(),
  discoveryCollections: z.number().int().nonnegative(),
  queryTimestamp: z.string()
})

const systemListOutputSchema = z.object({
  ...V1_SUCCESS_SHAPE,
  data: systemListDataSchema
})

const systemInspectOutputSchema = z.object({
  ...V1_SUCCESS_SHAPE,
  data: systemInspectDataSchema
})

export function registerV1SystemTools(
  server: McpServer,
  service: V1ReadService,
  enabledTools?: ReadonlySet<string>
): void {
  if (!enabledTools || enabledTools.has(SYSTEM_LIST_TOOL)) {
    server.registerTool(
      SYSTEM_LIST_TOOL,
      {
        title: "List SAP Systems",
        description: "List configured SAP system IDs and local credential availability.",
        inputSchema: {},
        outputSchema: systemListOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      async () => runV1Tool(async () => v1Success(await service.getConnectedSystems()))
    )
  }

  if (!enabledTools || enabledTools.has(SYSTEM_INSPECT_TOOL)) {
    server.registerTool(
      SYSTEM_INSPECT_TOOL,
      {
        title: "Inspect SAP System",
        description:
          "Read normalized SAP client, release, timezone, and optional software component metadata.",
        inputSchema: {
          systemId: z.string().min(1),
          includeComponents: z.boolean().default(false)
        },
        outputSchema: systemInspectOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      async ({ systemId, includeComponents }) => runV1Tool(async () => {
        const normalizedSystemId = systemId.trim().toUpperCase()
        const info = await service.getSapSystemInfo(normalizedSystemId, includeComponents)
        const {
          profileId: _profileId,
          url: _url,
          username: _username,
          warnings: rawWarnings,
          ...data
        } = info
        const warnings = rawWarnings.map(message => ({
          code: "SAP_SYSTEM_WARNING",
          message
        }))
        return v1Success(data, {
          systemId: normalizedSystemId,
          ...(warnings.length > 0 ? { status: "partial" as const } : {}),
          warnings
        })
      })
    )
  }
}
