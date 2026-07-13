import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { errorPayload } from "./errors.js"
import type { AbapToolService } from "./tool-service.js"

export const ABAP_OBJECT_TYPES = [
  "FUNC",
  "CLAS",
  "TABL",
  "PROG",
  "INTF",
  "DTEL",
  "DDLS",
  "DOMA",
  "TTYP",
  "ENQU",
  "MSAG",
  "FUGR",
  "DEVC",
  "TRAN",
  "VIEW",
  "SICF",
  "WDYN",
  "SPRX",
  "XSLT",
  "TRANSFORMATIONS",
  "SUSH",
  "SUSC",
  "PINF",
  "ENHC",
  "ENHS",
  "BADI",
  "BADII",
  "SAMC",
  "SAPC",
  "SFSW",
  "SFBF",
  "SFBS",
  "JOBD",
  "NROB",
  "ENHO",
  "SUSO",
  "BDEF",
  "SRVB"
] as const

function success(value: unknown) {
  const text = JSON.stringify(value, null, 2)
  return {
    content: [{ type: "text" as const, text }]
  }
}

function failure(error: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(errorPayload(error), null, 2) }],
    isError: true
  }
}

async function runTool<T>(operation: () => Promise<T>) {
  try {
    return success(await operation())
  } catch (error) {
    return failure(error)
  }
}

export function createMcpServer(tools: AbapToolService): McpServer {
  const server = new McpServer(
    { name: "sap-abap-mcp", version: "0.1.1" },
    {
      instructions:
        "Call get_connected_systems when connectionId is unknown. Search before reading, and read actual SAP source before suggesting ABAP changes or signatures. These tools read active server state only; unsaved editor changes are not visible. This build is read-only."
    }
  )
  const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  }

  server.registerTool(
    "get_connected_systems",
    {
      title: "Get Connected SAP Systems",
      description:
        "List configured SAP connection IDs and whether credentials are available. Call this first if connectionId is unknown.",
      inputSchema: {},
      annotations: readOnlyAnnotations
    },
    async () => runTool(() => tools.getConnectedSystems())
  )

  server.registerTool(
    "get_sap_system_info",
    {
      title: "Get SAP System Info",
      description:
        "Get SAP client, system type, release, timezone, and optionally the full software component list.",
      inputSchema: {
        connectionId: z.string().min(1).describe("SAP profile/connection ID, for example DEV100"),
        includeComponents: z.boolean().default(false)
      },
      annotations: readOnlyAnnotations
    },
    async ({ connectionId, includeComponents }) =>
      runTool(() => tools.getSapSystemInfo(connectionId, includeComponents))
  )

  server.registerTool(
    "search_abap_objects",
    {
      title: "Search ABAP Objects",
      description:
        "Search ABAP repository objects by name pattern. Supports SAP ADT wildcards such as * and ?.",
      inputSchema: {
        pattern: z.string().min(1),
        types: z.array(z.enum(ABAP_OBJECT_TYPES)).min(1),
        maxResults: z.number().int().min(1).max(500).default(20),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async ({ pattern, types, maxResults, connectionId }) =>
      runTool(() => tools.searchObjects({ pattern, types, maxResults, connectionId }))
  )

  server.registerTool(
    "get_abap_object_lines",
    {
      title: "Get ABAP Object Lines",
      description:
        "Read active ABAP source lines. objectType disambiguates objects; methodName extracts one class method.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.enum(ABAP_OBJECT_TYPES).optional(),
        methodName: z.string().min(1).optional(),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(5000).default(50),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.getObjectLines({
          objectName: input.objectName,
          startLine: input.startLine,
          lineCount: input.lineCount,
          connectionId: input.connectionId,
          ...(input.objectType ? { objectType: input.objectType } : {}),
          ...(input.methodName ? { methodName: input.methodName } : {})
        })
      )
  )

  return server
}

export async function startStdioServer(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport())
}
