import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type {
  AbapToolService,
  InspectCodeInput
} from "../../tool-service.js"
import { V1_SCHEMA_VERSION } from "./contracts.js"
import { normalizeV1SystemId } from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"
import { V1_READ_ONLY_ANNOTATIONS } from "./system-tools.js"

const SYSTEM_ID = z.string().min(1)
const FILE_URI = z.string().min(1)
const OBJECT_NAME = z.string().min(1)
const OBJECT_TYPE = z.string().min(1)
const START_INDEX = z.number().int().min(0).default(0)
const MAX_RESULTS = z.number().int().min(1).max(1000).default(50)

const coreOutputSchema = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.literal("succeeded"),
  systemId: z.string().min(1).optional(),
  data: z.looseObject({}),
  warnings: z.array(z.never()).max(0)
})

function enabled(name: string, selected?: ReadonlySet<string>): boolean {
  return selected === undefined || selected.has(name)
}

function resultData(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("The shared service returned a non-object result")
  }
  const { connectionId: _connectionId, ...data } = result as Record<string, unknown>
  return data
}

async function serviceResult(
  systemId: string,
  operation: (normalizedSystemId: string) => Promise<unknown>
) {
  return runV1Tool(async () => {
    const normalizedSystemId = normalizeV1SystemId(systemId)
    return v1Success(resultData(await operation(normalizedSystemId)), {
      systemId: normalizedSystemId
    })
  })
}

interface SemanticCallInput {
  systemId: string
  fileUri: string
  line?: number | undefined
  column?: number | undefined
  endColumn?: number | undefined
  implementation?: boolean | undefined
  superTypes?: boolean | undefined
  startIndex?: number | undefined
  limit?: number | undefined
}

function inspectInput(
  input: SemanticCallInput,
  action: InspectCodeInput["action"]
): InspectCodeInput {
  return {
    action,
    connectionId: normalizeV1SystemId(input.systemId),
    fileUri: input.fileUri,
    line: input.line ?? 1,
    column: input.column ?? 0,
    implementation: input.implementation ?? false,
    superTypes: input.superTypes ?? false,
    startIndex: input.startIndex ?? 0,
    maxResults: input.limit ?? 50,
    ...(input.endColumn !== undefined ? { endColumn: input.endColumn } : {})
  }
}

function semanticResult(
  service: AbapToolService,
  input: SemanticCallInput,
  action: InspectCodeInput["action"]
) {
  return serviceResult(input.systemId, async () => service.inspectCode(
    inspectInput(input, action)
  ))
}

export function registerV1CoreTools(
  server: McpServer,
  service: AbapToolService,
  selected?: ReadonlySet<string>
): void {
  if (enabled("sap.repository.inspect", selected)) {
    server.registerTool(
      "sap.repository.inspect",
      {
        title: "Inspect SAP Repository Object",
        description: "Read metadata and optional ADT structure for one ABAP object.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          objectName: OBJECT_NAME,
          objectType: OBJECT_TYPE.optional(),
          includeStructure: z.boolean().default(false)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.getObjectInfo({
        connectionId: systemId,
        objectName: input.objectName,
        includeStructure: input.includeStructure,
        ...(input.objectType ? { objectType: input.objectType } : {})
      }))
    )
  }

  if (enabled("sap.repository.resolve", selected)) {
    server.registerTool(
      "sap.repository.resolve",
      {
        title: "Resolve SAP Repository Object",
        description: "Resolve one ABAP object to a canonical ADT Resource.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          objectName: OBJECT_NAME,
          objectType: OBJECT_TYPE.optional(),
          includeSourceSummary: z.boolean().default(true)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => input.includeSourceSummary
        ? service.openObject({
            connectionId: systemId,
            objectName: input.objectName,
            ...(input.objectType ? { objectType: input.objectType } : {})
          })
        : service.getObjectWorkspaceUri({
            connectionId: systemId,
            objectName: input.objectName,
            objectType: input.objectType ?? "PROG/P"
          }))
    )
  }

  if (enabled("sap.repository.where_used", selected)) {
    server.registerTool(
      "sap.repository.where_used",
      {
        title: "Find SAP Repository Usages",
        description: "Find bounded where-used references for one ABAP object.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          objectName: OBJECT_NAME,
          objectType: OBJECT_TYPE.optional(),
          searchTerm: z.string().min(1).optional(),
          line: z.number().int().min(1).optional(),
          character: z.number().int().min(0).optional(),
          includeSnippets: z.boolean().default(false),
          startIndex: START_INDEX,
          limit: MAX_RESULTS,
          filter: z.object({
            objectNamePattern: z.string().min(1).optional(),
            objectTypes: z.array(z.string().min(1)).min(1).optional(),
            excludeSystemObjects: z.boolean().optional()
          }).strict().optional()
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.findWhereUsed({
        connectionId: systemId,
        objectName: input.objectName,
        maxResults: input.limit,
        includeSnippets: input.includeSnippets,
        startIndex: input.startIndex,
        ...(input.objectType ? { objectType: input.objectType } : {}),
        ...(input.searchTerm ? { searchTerm: input.searchTerm } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.character !== undefined ? { character: input.character } : {}),
        ...(input.filter ? {
          filter: {
            ...(input.filter.objectNamePattern
              ? { objectNamePattern: input.filter.objectNamePattern }
              : {}),
            ...(input.filter.objectTypes
              ? { objectTypes: input.filter.objectTypes }
              : {}),
            ...(input.filter.excludeSystemObjects !== undefined
              ? { excludeSystemObjects: input.filter.excludeSystemObjects }
              : {})
          }
        } : {})
      }))
    )
  }

  if (enabled("sap.semantic.complete", selected)) {
    server.registerTool(
      "sap.semantic.complete",
      {
        title: "Complete ABAP Code",
        description: "Read ABAP completion proposals or element details.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          line: z.number().int().min(1).default(1),
          column: z.number().int().min(0).default(0),
          elementDetails: z.boolean().default(false),
          startIndex: START_INDEX,
          limit: z.number().int().min(1).max(500).default(50)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(
        service,
        input,
        input.elementDetails ? "completion_element" : "completion"
      )
    )
  }

  if (enabled("sap.semantic.components", selected)) {
    server.registerTool(
      "sap.semantic.components",
      {
        title: "List ABAP Components",
        description: "List bounded ABAP class or interface components.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          startIndex: START_INDEX,
          limit: z.number().int().min(1).max(500).default(50)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(service, input, "components")
    )
  }

  if (enabled("sap.semantic.definition", selected)) {
    server.registerTool(
      "sap.semantic.definition",
      {
        title: "Find ABAP Definition",
        description: "Resolve an ABAP definition or implementation.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          line: z.number().int().min(1).default(1),
          column: z.number().int().min(0).default(0),
          endColumn: z.number().int().min(0).optional(),
          implementation: z.boolean().default(false)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(service, input, "definition")
    )
  }

  if (enabled("sap.semantic.documentation", selected)) {
    server.registerTool(
      "sap.semantic.documentation",
      {
        title: "Read ABAP Documentation",
        description: "Read SAP ABAP language documentation.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          line: z.number().int().min(1).default(1),
          column: z.number().int().min(0).default(0)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(service, input, "documentation")
    )
  }

  if (enabled("sap.semantic.format_preview", selected)) {
    server.registerTool(
      "sap.semantic.format_preview",
      {
        title: "Preview ABAP Formatting",
        description: "Preview SAP ABAP formatter changes.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(service, input, "format_preview")
    )
  }

  if (enabled("sap.semantic.hierarchy", selected)) {
    server.registerTool(
      "sap.semantic.hierarchy",
      {
        title: "Read ABAP Type Hierarchy",
        description: "Read a bounded ABAP type hierarchy.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          line: z.number().int().min(1).default(1),
          column: z.number().int().min(0).default(0),
          superTypes: z.boolean().default(false),
          startIndex: START_INDEX,
          limit: z.number().int().min(1).max(500).default(50)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(service, input, "type_hierarchy")
    )
  }

  if (enabled("sap.semantic.quick_fixes", selected)) {
    server.registerTool(
      "sap.semantic.quick_fixes",
      {
        title: "List ABAP Quick Fixes",
        description: "List bounded non-dialog SAP quick fixes.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          line: z.number().int().min(1).default(1),
          column: z.number().int().min(0).default(0),
          startIndex: START_INDEX,
          limit: z.number().int().min(1).max(500).default(50)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => semanticResult(service, input, "quick_fixes")
    )
  }

  if (enabled("sap.source.diagnose", selected)) {
    server.registerTool(
      "sap.source.diagnose",
      {
        title: "Diagnose ABAP Source",
        description: "Run bounded SAP syntax diagnostics for ABAP source.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          fileUri: FILE_URI,
          severity: z.string().min(1).optional(),
          startIndex: START_INDEX,
          limit: z.number().int().min(1).max(1000).default(100)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.getAbapDiagnostics({
        connectionId: systemId,
        fileUri: input.fileUri,
        startIndex: input.startIndex,
        maxResults: input.limit,
        ...(input.severity ? { severity: input.severity } : {})
      }))
    )
  }

  if (enabled("sap.source.read_batch", selected)) {
    server.registerTool(
      "sap.source.read_batch",
      {
        title: "Read ABAP Source Batch",
        description: "Read source ranges from up to 100 ABAP objects.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          requests: z.array(z.object({
            objectName: OBJECT_NAME,
            startLine: z.number().int().min(1).default(1),
            lineCount: z.number().int().min(1).max(5000).default(10)
          }).strict()).min(1).max(100)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.getBatchLines({
        connectionId: systemId,
        requests: input.requests.map(request => ({
          objectName: request.objectName,
          startLine: request.startLine - 1,
          lineCount: request.lineCount
        }))
      }))
    )
  }

  if (enabled("sap.source.search", selected)) {
    server.registerTool(
      "sap.source.search",
      {
        title: "Search ABAP Source",
        description: "Search literal text or a regular expression in ABAP source.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          objectName: OBJECT_NAME,
          searchTerm: z.string().min(1),
          contextLines: z.number().int().min(0).max(50).default(3),
          regularExpression: z.boolean().default(false),
          maxObjects: z.number().int().min(1).max(10).default(1),
          startIndex: START_INDEX,
          limit: z.number().int().min(1).max(500).default(50)
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.searchObjectLines({
        connectionId: systemId,
        objectName: input.objectName,
        searchTerm: input.searchTerm,
        contextLines: input.contextLines,
        isRegexp: input.regularExpression,
        maxObjects: input.maxObjects,
        startIndex: input.startIndex,
        maxResults: input.limit
      }))
    )
  }

  if (enabled("sap.text_elements.read", selected)) {
    server.registerTool(
      "sap.text_elements.read",
      {
        title: "Read ABAP Text Elements",
        description: "Read one ABAP text-pool category.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          objectName: OBJECT_NAME,
          objectType: z.enum(["PROGRAM", "CLASS", "FUNCTION_GROUP"]),
          category: z.enum(["symbols", "selections", "headings"]).default("symbols")
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.manageTextElements({
        action: "read",
        connectionId: systemId,
        objectName: input.objectName,
        objectType: input.objectType,
        category: input.category
      }))
    )
  }

  if (enabled("sap.ui.object_url", selected)) {
    server.registerTool(
      "sap.ui.object_url",
      {
        title: "Build SAP Object URL",
        description: "Build a SAP WebGUI URL for one ABAP object.",
        inputSchema: z.object({
          systemId: SYSTEM_ID,
          objectName: OBJECT_NAME,
          objectType: OBJECT_TYPE.default("PROG/P")
        }).strict(),
        outputSchema: coreOutputSchema,
        annotations: V1_READ_ONLY_ANNOTATIONS
      },
      input => serviceResult(input.systemId, systemId => service.getObjectUrl({
        connectionId: systemId,
        objectName: input.objectName,
        objectType: input.objectType
      }))
    )
  }
}
