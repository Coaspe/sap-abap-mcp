import {
  McpServer,
  type RegisteredTool,
  type ToolCallback
} from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type {
  AnySchema,
  ZodRawShapeCompat
} from "@modelcontextprotocol/sdk/server/zod-compat.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { RapGeneratorContent } from "abap-adt-api"
import { errorPayload } from "./errors.js"
import { MERMAID_DIAGRAM_TYPES } from "./mermaid-tools.js"
import type {
  AbapToolService,
  ActivateObjectInput,
  RunAbapApplicationInput
} from "./tool-service.js"

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
  const text = JSON.stringify(value)
  return {
    content: [{ type: "text" as const, text }]
  }
}

function failure(error: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(errorPayload(error)) }],
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

export interface McpServerOptions {
  enabledTools?: ReadonlySet<string>
}

export function createMcpServer(
  tools: AbapToolService,
  options: McpServerOptions = {}
): McpServer {
  const server = new McpServer(
    {
      name: "sap-abap-mcp",
      version: "0.4.5",
      title: "SAP ABAP MCP",
      description:
        "Develop, test, analyze, and operate SAP ABAP systems through ADT from AI coding agents.",
      websiteUrl: "https://github.com/Coaspe/sap-abap-mcp",
      icons: [{
        src: "https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/directory-icon.png",
        mimeType: "image/png",
        sizes: ["400x400"]
      }]
    },
    {
      instructions:
        "Call get_connected_systems when connectionId is unknown. Search before reading, and read actual SAP source before suggesting ABAP changes or signatures. Writes are blocked for production profiles; a non-empty allowedPackages list restricts writes to those packages, while an empty list allows all packages. Read current source before editing, provide a transport for non-local packages, then inspect returned diagnostics before activation."
    }
  )
  const readOnlyAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true
  }
  const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  }
  const analysisAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }
  const rapContentSchema = z.object({
    metadata: z.object({
      package: z.string().min(1),
      masterLanguage: z.string().min(1).optional()
    }).optional(),
    general: z.object({
      referenceObjectName: z.string().min(1).optional(),
      description: z.string()
    }),
    businessObject: z.object({
      dataModelEntity: z.object({
        cdsName: z.string().min(1),
        entityName: z.string().min(1).optional()
      }),
      behavior: z.object({
        implementationType: z.string().min(1),
        implementationClass: z.string().min(1),
        draftTable: z.string()
      })
    }),
    serviceProjection: z.object({ name: z.string().min(1) }),
    businessService: z.object({
      serviceDefinition: z.object({ name: z.string().min(1) }),
      serviceBinding: z.object({
        name: z.string().min(1),
        bindingType: z.string().min(1)
      })
    })
  })
  const registerTool = <
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined
  >(
    name: string,
    config: {
      title?: string
      description?: string
      inputSchema?: InputArgs
      outputSchema?: OutputArgs
      annotations?: ToolAnnotations
      _meta?: Record<string, unknown>
    },
    callback: ToolCallback<InputArgs>
  ): RegisteredTool | undefined => {
    if (options.enabledTools && !options.enabledTools.has(name)) return undefined
    return server.registerTool(name, config, callback)
  }

  registerTool(
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

  registerTool(
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

  registerTool(
    "get_sap_capabilities",
    {
      title: "Get SAP Capabilities",
      description:
        "Report implemented, missing, supported, unsupported, and live-unverified SAP development capabilities for one connection.",
      inputSchema: {
        connectionId: z.string().min(1),
        category: z.enum([
          "connection",
          "repository",
          "execution",
          "semantic",
          "quality",
          "debugging",
          "insight"
        ]).optional(),
        includeEvidence: z.boolean().default(true)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getSapCapabilities(
      input.connectionId,
      input.category,
      input.includeEvidence
    ))
  )

  registerTool(
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

  registerTool(
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

  registerTool(
    "search_abap_object_lines",
    {
      title: "Search ABAP Object Lines",
      description:
        "Search literal text or a regular expression in active ABAP source. Wildcard object names can scan up to 10 objects.",
      inputSchema: {
        objectName: z.string().min(1),
        searchTerm: z.string().min(1),
        contextLines: z.number().int().min(0).max(50).default(3),
        connectionId: z.string().min(1),
        isRegexp: z.boolean().default(false),
        maxObjects: z.number().int().min(1).max(10).default(1),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.searchObjectLines(input))
  )

  registerTool(
    "get_abap_object_info",
    {
      title: "Get ABAP Object Info",
      description: "Get repository metadata, ADT structure, source URI, and active source line count.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.enum(ABAP_OBJECT_TYPES).optional(),
        connectionId: z.string().min(1),
        includeStructure: z.boolean().default(false)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.getObjectInfo({
          objectName: input.objectName,
          connectionId: input.connectionId,
          includeStructure: input.includeStructure,
          ...(input.objectType ? { objectType: input.objectType } : {})
        })
      )
  )

  registerTool(
    "get_batch_lines",
    {
      title: "Get Batch Lines",
      description:
        "Read active source ranges from multiple ABAP objects. startLine is zero-based for ABAP FS compatibility.",
      inputSchema: {
        requests: z.array(z.object({
          objectName: z.string().min(1),
          startLine: z.number().int().min(0).default(0),
          lineCount: z.number().int().min(1).max(5000).default(10)
        })).min(1).max(100),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getBatchLines(input))
  )

  registerTool(
    "get_object_by_uri",
    {
      title: "Get ABAP Object by URI",
      description:
        "Read active ABAP source directly by ADT object or source URI. startLine is zero-based for ABAP FS compatibility.",
      inputSchema: {
        uri: z.string().startsWith("/sap/bc/adt/"),
        startLine: z.number().int().min(0).default(0),
        lineCount: z.number().int().min(1).max(5000).default(50),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getObjectByUri(input))
  )

  registerTool(
    "create_mermaid_diagram",
    {
      title: "Create Mermaid Diagram",
      description:
        "Validate Mermaid code and create an interactive local HTML viewer with zoom controls and SVG export.",
      inputSchema: {
        code: z.string().min(1),
        diagramType: z.enum([...MERMAID_DIAGRAM_TYPES, "auto"]).default("auto"),
        theme: z.enum(["default", "dark", "forest", "neutral"]).default("forest")
      },
      annotations: analysisAnnotations
    },
    async input =>
      runTool(() => tools.createMermaidDiagram(input.code, input.diagramType, input.theme))
  )

  registerTool(
    "validate_mermaid_syntax",
    {
      title: "Validate Mermaid Syntax",
      description: "Parse Mermaid code without rendering and return the normalized diagram type.",
      inputSchema: {
        code: z.string().min(1),
        suppressErrors: z.boolean().default(true)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.validateMermaidSyntax(input.code, input.suppressErrors))
  )

  registerTool(
    "get_mermaid_documentation",
    {
      title: "Get Mermaid Documentation",
      description: "Get bundled syntax, keywords, and usage tips for supported Mermaid diagram types.",
      inputSchema: {
        diagramType: z.enum(["all", ...MERMAID_DIAGRAM_TYPES]).default("all"),
        includeExamples: z.boolean().default(false)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(async () => tools.getMermaidDocumentation(input.diagramType, input.includeExamples))
  )

  registerTool(
    "detect_mermaid_diagram_type",
    {
      title: "Detect Mermaid Diagram Type",
      description: "Parse Mermaid code and return its normalized and native Mermaid diagram types.",
      inputSchema: { code: z.string().min(1) },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.detectMermaidDiagramType(input.code))
  )

  registerTool(
    "create_test_documentation",
    {
      title: "Create Test Documentation",
      description:
        "Create a styled Word report from test scenarios and screenshots, returning the local DOCX path.",
      inputSchema: {
        scenarios: z.array(z.object({
          scenarioId: z.number().int().min(1),
          scenarioName: z.string().min(1),
          scenarioDescription: z.string().min(1),
          screenshots: z.array(z.object({
            filePath: z.string().min(1),
            description: z.string().min(1)
          }))
        })).min(1),
        reportTitle: z.string().min(1).optional(),
        testDate: z.string().regex(/^\d{2}-\d{2}-\d{4}$/).optional()
      },
      annotations: analysisAnnotations
    },
    async input =>
      runTool(() => tools.createTestDocumentation({
        scenarios: input.scenarios,
        ...(input.reportTitle ? { reportTitle: input.reportTitle } : {}),
        ...(input.testDate ? { testDate: input.testDate } : {})
      }))
  )

  registerTool(
    "abap_fs_documentation",
    {
      title: "ABAP FS Documentation",
      description:
        "Read or search the bundled ABAP FS compatibility and sap-abap-mcp settings reference.",
      inputSchema: {
        action: z.enum([
          "get_documentation", "search_documentation", "get_settings", "search_settings"
        ]),
        searchQuery: z.string().min(1).optional(),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(200).default(50)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(async () => tools.getAbapFsDocumentation({
        action: input.action,
        startLine: input.startLine,
        lineCount: input.lineCount,
        ...(input.searchQuery ? { searchQuery: input.searchQuery } : {})
      }))
  )

  registerTool(
    "create_object_programmatically",
    {
      title: "Create ABAP Object Programmatically",
      description:
        "Validate and create an ADT repository object. Non-local packages require an existing or new transport request; a configured profile write allowlist must include the package.",
      inputSchema: {
        objectType: z.string().min(1).describe("Creatable ADT type such as PROG/P or CLAS/OC"),
        name: z.string().min(1),
        description: z.string().min(1).max(60),
        packageName: z.string().min(1).default("$TMP"),
        parentName: z.string().min(1).optional(),
        connectionId: z.string().min(1),
        source: z.string().optional(),
        activate: z.boolean().default(false),
        additionalOptions: z.object({
          serviceDefinition: z.string().min(1).optional(),
          bindingType: z.literal("ODATA").optional(),
          bindingCategory: z.enum(["0", "1"]).optional(),
          softwareComponent: z.string().min(1).optional(),
          packageType: z.enum(["development", "structure", "main"]).optional(),
          transportLayer: z.string().optional(),
          transportRequest: z.discriminatedUnion("type", [
            z.object({ type: z.literal("existing"), number: z.string().min(1) }),
            z.object({ type: z.literal("new"), description: z.string().min(1) })
          ]).optional()
        }).optional()
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.createObjectProgrammatically({
          objectType: input.objectType,
          name: input.name,
          description: input.description,
          packageName: input.packageName,
          connectionId: input.connectionId,
          activate: input.activate,
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.parentName ? { parentName: input.parentName } : {}),
          ...(input.additionalOptions ? {
            additionalOptions: {
              ...(input.additionalOptions.serviceDefinition
                ? { serviceDefinition: input.additionalOptions.serviceDefinition }
                : {}),
              ...(input.additionalOptions.bindingType
                ? { bindingType: input.additionalOptions.bindingType }
                : {}),
              ...(input.additionalOptions.bindingCategory
                ? { bindingCategory: input.additionalOptions.bindingCategory }
                : {}),
              ...(input.additionalOptions.softwareComponent
                ? { softwareComponent: input.additionalOptions.softwareComponent }
                : {}),
              ...(input.additionalOptions.packageType
                ? { packageType: input.additionalOptions.packageType }
                : {}),
              ...(input.additionalOptions.transportLayer !== undefined
                ? { transportLayer: input.additionalOptions.transportLayer }
                : {}),
              ...(input.additionalOptions.transportRequest
                ? { transportRequest: input.additionalOptions.transportRequest }
                : {})
            }
          } : {})
        })
      )
  )

  registerTool(
    "execute_data_query",
    {
      title: "Execute ABAP Data Query",
      description:
        "Run a read-only SAP ADT data-preview query, process supplied structured data, return a bounded headless result, or export CSV/XLSX.",
      inputSchema: {
        sql: z.string().min(1).optional(),
        data: z.object({
          columns: z.array(z.object({
            name: z.string().min(1),
            type: z.string().min(1),
            description: z.string().optional()
          })).min(1),
          values: z.array(z.record(z.string(), z.unknown()))
        }).optional(),
        displayMode: z.enum(["internal", "ui", "download_to_file"]),
        webviewId: z.string().min(1).optional(),
        connectionId: z.string().min(1),
        title: z.string().min(1).optional(),
        maxRows: z.number().int().min(1).max(50000).default(1000),
        rowRange: z.object({
          start: z.number().int().min(0),
          end: z.number().int().min(1)
        }).optional(),
        sortColumns: z.array(z.object({
          column: z.string().min(1),
          direction: z.enum(["asc", "desc"])
        })).optional(),
        filters: z.array(z.object({
          column: z.string().min(1),
          value: z.string()
        })).optional(),
        resetSorting: z.boolean().optional(),
        resetFilters: z.boolean().optional(),
        filePath: z.string().min(1).optional(),
        fileType: z.enum(["xlsx", "csv"]).optional()
      },
      annotations: analysisAnnotations
    },
    async input =>
      runTool(() =>
        tools.executeDataQuery({
          displayMode: input.displayMode,
          connectionId: input.connectionId,
          maxRows: input.maxRows,
          ...(input.webviewId ? { webviewId: input.webviewId } : {}),
          ...(input.sql ? { sql: input.sql } : {}),
          ...(input.data ? {
            data: {
              columns: input.data.columns.map(column => ({
                name: column.name,
                type: column.type,
                ...(column.description ? { description: column.description } : {})
              })),
              values: input.data.values
            }
          } : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(input.rowRange ? { rowRange: input.rowRange } : {}),
          ...(input.sortColumns ? { sortColumns: input.sortColumns } : {}),
          ...(input.filters ? { filters: input.filters } : {}),
          ...(input.resetSorting !== undefined ? { resetSorting: input.resetSorting } : {}),
          ...(input.resetFilters !== undefined ? { resetFilters: input.resetFilters } : {}),
          ...(input.filePath ? { filePath: input.filePath } : {}),
          ...(input.fileType ? { fileType: input.fileType } : {})
        })
      )
  )

  registerTool(
    "get_abap_sql_syntax",
    {
      title: "Get ABAP SQL Syntax",
      description: "Return the safe SAP ADT data-preview SQL rules used by execute_data_query.",
      inputSchema: {},
      annotations: readOnlyAnnotations
    },
    async () => runTool(async () => tools.getAbapSqlSyntax())
  )

  registerTool(
    "run_atc_analysis",
    {
      title: "Run ATC Analysis",
      description:
        "Run the system ATC check variant for an exact object, or retrieve documentation for a prior finding.",
      inputSchema: {
        action: z.enum(["run_analysis", "get_documentation"]).default("run_analysis"),
        objectName: z.string().min(1).optional(),
        objectType: z.string().min(1).optional(),
        objectUri: z.string().min(1).optional(),
        connectionId: z.string().min(1).optional(),
        useActiveFile: z.boolean().default(false),
        scope: z.enum(["object", "package", "transport"]).default("object"),
        docUri: z.string().min(1).optional(),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50),
        documentationOffset: z.number().int().min(0).default(0),
        documentationLength: z.number().int().min(1).max(20000).default(4000)
      },
      annotations: analysisAnnotations
    },
    async input =>
      runTool(() =>
        tools.runAtcAnalysis({
          action: input.action,
          ...(input.objectName ? { objectName: input.objectName } : {}),
          ...(input.objectType ? { objectType: input.objectType } : {}),
          ...(input.objectUri ? { objectUri: input.objectUri } : {}),
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.docUri ? { docUri: input.docUri } : {}),
          startIndex: input.startIndex,
          maxResults: input.maxResults,
          documentationOffset: input.documentationOffset,
          documentationLength: input.documentationLength
        })
      )
  )

  registerTool(
    "get_atc_decorations",
    {
      title: "Get ATC Decorations",
      description:
        "Return cached headless ATC findings from run_atc_analysis, optionally for one workspace URI.",
      inputSchema: {
        fileUri: z.string().min(1).optional(),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(async () =>
      tools.getAtcDecorations(input.fileUri, input.startIndex, input.maxResults)
    )
  )

  registerTool(
    "manage_text_elements",
    {
      title: "Manage ABAP Text Elements",
      description:
        "Read or merge-create/update REPT text-pool symbols, selection texts, and headings using ADT locking, transport enforcement, and activation.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.enum(["PROGRAM", "CLASS", "FUNCTION_GROUP"]),
        action: z.enum(["read", "create", "update"]),
        textElements: z.array(z.object({
          id: z.string().regex(/^[A-Z0-9_]{1,8}$/i),
          text: z.string().max(255),
          maxLength: z.number().int().min(1).max(255).optional()
        })).min(1).optional(),
        category: z.enum(["symbols", "selections", "headings"]).default("symbols"),
        connectionId: z.string().min(1),
        transport: z.string().min(1).optional()
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.manageTextElements({
          objectName: input.objectName,
          objectType: input.objectType,
          action: input.action,
          category: input.category,
          connectionId: input.connectionId,
          ...(input.textElements ? {
            textElements: input.textElements.map(element => ({
              id: element.id,
              text: element.text,
              ...(element.maxLength !== undefined ? { maxLength: element.maxLength } : {})
            }))
          } : {}),
          ...(input.transport ? { transport: input.transport } : {})
        })
      )
  )

  registerTool(
    "find_where_used",
    {
      title: "Find Where Used",
      description:
        "Find ADT usage references for an ABAP object or a symbol position, with filtering, pagination, and optional snippets.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1).optional(),
        searchTerm: z.string().min(1).optional(),
        line: z.number().int().min(1).optional(),
        character: z.number().int().min(0).optional(),
        connectionId: z.string().min(1),
        maxResults: z.number().int().min(1).max(1000).default(50),
        includeSnippets: z.boolean().default(false),
        startIndex: z.number().int().min(0).default(0),
        filter: z.object({
          objectNamePattern: z.string().min(1).optional(),
          objectTypes: z.array(z.string().min(1)).min(1).optional(),
          excludeSystemObjects: z.boolean().optional()
        }).optional()
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.findWhereUsed({
          objectName: input.objectName,
          connectionId: input.connectionId,
          maxResults: input.maxResults,
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
              ...(input.filter.objectTypes ? { objectTypes: input.filter.objectTypes } : {}),
              ...(input.filter.excludeSystemObjects !== undefined
                ? { excludeSystemObjects: input.filter.excludeSystemObjects }
                : {})
            }
          } : {})
        })
      )
  )

  registerTool(
    "get_abap_object_url",
    {
      title: "Get ABAP Object URL",
      description:
        "Generate a SAP WebGUI URL for an ABAP report, class, or function module.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1).default("PROG/P"),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getObjectUrl(input))
  )

  registerTool(
    "get_abap_object_workspace_uri",
    {
      title: "Get ABAP Object Workspace URI",
      description:
        "Resolve an exact ABAP object to a stable adt:// URI usable by headless source-edit tools.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getObjectWorkspaceUri(input))
  )

  registerTool(
    "open_object",
    {
      title: "Open ABAP Object",
      description:
        "Resolve an ABAP object in headless mode and return its ADT and workspace URIs for subsequent reads or edits.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1).optional(),
        connectionId: z.string().min(1)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.openObject({
          objectName: input.objectName,
          connectionId: input.connectionId,
          ...(input.objectType ? { objectType: input.objectType } : {})
        })
      )
  )

  registerTool(
    "abap_download",
    {
      title: "Download ABAP Resource",
      description:
        "Download one ABAP source object or the readable objects in a package to an absolute local folder.",
      inputSchema: {
        source: z.string().min(1),
        target: z.string().min(1),
        connectionId: z.string().min(1).optional(),
        objectType: z.string().min(1).optional(),
        overwrite: z.boolean().default(false),
        includeFileList: z.boolean().default(false)
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.downloadAbap({
          source: input.source,
          target: input.target,
          overwrite: input.overwrite,
          includeFileList: input.includeFileList,
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.objectType ? { objectType: input.objectType } : {})
        })
      )
  )

  registerTool(
    "run_unit_tests",
    {
      title: "Run ABAP Unit Tests",
      description: "Run SAP ABAP Unit for an exact repository object and return structured results.",
      inputSchema: {
        objectName: z.string().min(1),
        connectionId: z.string().min(1),
        detailLevel: z.enum(["summary", "failures", "all"]).default("failures")
      },
      annotations: analysisAnnotations
    },
    async input => runTool(() =>
      tools.runUnitTests(input.objectName, input.connectionId, input.detailLevel)
    )
  )

  registerTool(
    "create_test_include",
    {
      title: "Create ABAP Test Include",
      description:
        "Create a class test include under a package permitted by the profile's optional allowlist. A transport is required outside $TMP.",
      inputSchema: {
        className: z.string().min(1),
        connectionId: z.string().min(1),
        transport: z.string().min(1).optional()
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.createTestInclude(
          input.className,
          input.connectionId,
          input.transport
        )
      )
  )

  registerTool(
    "manage_transport_requests",
    {
      title: "Manage Transport Requests",
      description:
        "List, inspect, compare, create, release, delete, reassign, add objects (including LIMU DYNP/REPT subobjects), and resolve SAP transports. release/delete confirmation is the request number; owner/user confirmation is NUMBER:USER; object confirmation is NUMBER:PGMID:TYPE:NAME.",
      inputSchema: {
        action: z.enum([
          "get_user_transports",
          "get_transport_details",
          "get_transport_objects",
          "compare_transports",
          "create_transport",
          "release_transport",
          "delete_transport",
          "set_owner",
          "add_user",
          "add_object",
          "list_system_users",
          "resolve_object"
        ]),
        connectionId: z.string().min(1),
        transportNumber: z.string().min(1).optional(),
        transportNumbers: z.array(z.string().min(1)).min(2).max(10).optional(),
        user: z.string().min(1).optional(),
        targetUser: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        packageName: z.string().min(1).optional(),
        transportLayer: z.string().optional(),
        pgmid: z.string().min(1).optional(),
        objectType: z.string().min(1).optional(),
        objectName: z.string().min(1).optional(),
        ignoreLocks: z.boolean().default(false),
        ignoreAtc: z.boolean().default(false),
        confirmation: z.string().min(1).optional(),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50),
        includeObjects: z.boolean().default(false)
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.manageTransportRequests({
          action: input.action,
          connectionId: input.connectionId,
          startIndex: input.startIndex,
          maxResults: input.maxResults,
          includeObjects: input.includeObjects,
          ...(input.transportNumber ? { transportNumber: input.transportNumber } : {}),
          ...(input.transportNumbers ? { transportNumbers: input.transportNumbers } : {}),
          ...(input.user ? { user: input.user } : {}),
          ...(input.targetUser ? { targetUser: input.targetUser } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.packageName ? { packageName: input.packageName } : {}),
          ...(input.transportLayer !== undefined ? { transportLayer: input.transportLayer } : {}),
          ...(input.pgmid ? { pgmid: input.pgmid } : {}),
          ...(input.objectType ? { objectType: input.objectType } : {}),
          ...(input.objectName ? { objectName: input.objectName } : {}),
          ...(input.ignoreLocks !== undefined ? { ignoreLocks: input.ignoreLocks } : {}),
          ...(input.ignoreAtc !== undefined ? { ignoreAtc: input.ignoreAtc } : {}),
          ...(input.confirmation ? { confirmation: input.confirmation } : {})
        })
      )
  )

  registerTool(
    "get_version_history",
    {
      title: "Get ABAP Version History",
      description:
        "List repository revisions, retrieve source at a revision, or compare two revision snapshots.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1).optional(),
        connectionId: z.string().min(1),
        action: z.enum([
          "list_versions",
          "get_version_source",
          "compare_versions"
        ]).default("list_versions"),
        versionNumber: z.number().int().min(1).optional(),
        version1: z.number().int().min(1).optional(),
        version2: z.number().int().min(1).optional(),
        maxVersions: z.number().int().min(1).max(200).default(20),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(1000).default(200),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(5000).default(200)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.getVersionHistory({
          objectName: input.objectName,
          connectionId: input.connectionId,
          action: input.action,
          maxVersions: input.maxVersions,
          startIndex: input.startIndex,
          maxResults: input.maxResults,
          startLine: input.startLine,
          lineCount: input.lineCount,
          ...(input.objectType ? { objectType: input.objectType } : {}),
          ...(input.versionNumber !== undefined ? { versionNumber: input.versionNumber } : {}),
          ...(input.version1 !== undefined ? { version1: input.version1 } : {}),
          ...(input.version2 !== undefined ? { version2: input.version2 } : {})
        })
      )
  )

  registerTool(
    "abap_debug_session",
    {
      title: "ABAP Debug Session",
      description:
        "Start a non-blocking SAP debugger listener, stop it, or inspect its state. A separate stateful ADT client is used after a debuggee attaches.",
      inputSchema: {
        connectionId: z.string().min(1),
        action: z.enum(["start", "stop", "status"]).default("start"),
        debugUser: z.string().min(1).optional(),
        terminalMode: z.boolean().default(false)
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.manageDebugSession(
          input.connectionId,
          input.action,
          input.debugUser,
          input.terminalMode
        )
      )
  )

  registerTool(
    "abap_debug_breakpoint",
    {
      title: "ABAP Debug Breakpoint",
      description: "Set or remove line breakpoints for an adt:// ABAP source URI.",
      inputSchema: {
        connectionId: z.string().min(1),
        filePath: z.string().min(1),
        lineNumbers: z.array(z.number().int().min(1)).min(1),
        condition: z.string().min(1).optional(),
        action: z.enum(["set", "remove"]).default("set")
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.manageDebugBreakpoint({
          connectionId: input.connectionId,
          filePath: input.filePath,
          lineNumbers: input.lineNumbers,
          action: input.action,
          ...(input.condition ? { condition: input.condition } : {})
        })
      )
  )

  registerTool(
    "abap_debug_step",
    {
      title: "ABAP Debug Step",
      description: "Continue or step an attached ABAP debuggee and return the new raw stack.",
      inputSchema: {
        connectionId: z.string().min(1),
        stepType: z.enum(["continue", "stepInto", "stepOver", "stepReturn", "jumpToLine"]),
        threadId: z.number().int().min(1).default(1),
        targetLine: z.number().int().min(1).optional()
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.debugStep({
          connectionId: input.connectionId,
          stepType: input.stepType,
          threadId: input.threadId,
          ...(input.targetLine !== undefined ? { targetLine: input.targetLine } : {})
        })
      )
  )

  registerTool(
    "abap_debug_variable",
    {
      title: "ABAP Debug Variable",
      description:
        "Read variables or evaluate an ABAP expression in a selected stack frame. Call abap_debug_stack first for frameId.",
      inputSchema: {
        connectionId: z.string().min(1),
        threadId: z.number().int().min(1).default(1),
        frameId: z.number().int().min(1),
        variableName: z.string().min(1).optional(),
        expression: z.string().min(1).optional(),
        rowStart: z.number().int().min(0).default(0),
        rowCount: z.number().int().min(1).max(1000).default(50),
        filter: z.string().optional(),
        scopeName: z.string().min(1).optional(),
        maxVariables: z.number().int().min(1).max(5000).default(100),
        filterPattern: z.string().min(1).optional(),
        expandStructures: z.boolean().default(false),
        expandTables: z.boolean().default(false)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.getDebugVariables({
          connectionId: input.connectionId,
          frameId: input.frameId,
          rowStart: input.rowStart,
          rowCount: input.rowCount,
          maxVariables: input.maxVariables,
          expandStructures: input.expandStructures,
          expandTables: input.expandTables,
          ...(input.variableName ? { variableName: input.variableName } : {}),
          ...(input.expression ? { expression: input.expression } : {}),
          ...(input.filter ? { filter: input.filter } : {}),
          ...(input.scopeName ? { scopeName: input.scopeName } : {}),
          ...(input.filterPattern ? { filterPattern: input.filterPattern } : {})
        })
      )
  )

  registerTool(
    "abap_debug_stack",
    {
      title: "ABAP Debug Stack",
      description: "Get the current attached debuggee stack and stable frame IDs.",
      inputSchema: {
        connectionId: z.string().min(1),
        threadId: z.number().int().min(1).default(1)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getDebugStack(input.connectionId, input.threadId))
  )

  registerTool(
    "abap_debug_status",
    {
      title: "ABAP Debug Status",
      description: "Return listener, debuggee attachment, and breakpoint state for a connection.",
      inputSchema: { connectionId: z.string().min(1) },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.getDebugStatus(input.connectionId))
  )

  registerTool(
    "analyze_abap_dumps",
    {
      title: "Analyze ABAP Dumps",
      description: "List SAP runtime dumps or retrieve and normalize one dump's HTML content.",
      inputSchema: {
        action: z.enum(["list_dumps", "analyze_dump"]),
        connectionId: z.string().min(1),
        dumpId: z.string().min(1).optional(),
        maxResults: z.number().int().min(1).max(100).default(20),
        includeFullContent: z.boolean().default(false),
        startIndex: z.number().int().min(0).default(0),
        contentOffset: z.number().int().min(0).default(0),
        contentLength: z.number().int().min(1).max(20000).default(4000)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.analyzeDumps({
          action: input.action,
          connectionId: input.connectionId,
          maxResults: input.maxResults,
          includeFullContent: input.includeFullContent,
          startIndex: input.startIndex,
          contentOffset: input.contentOffset,
          contentLength: input.contentLength,
          ...(input.dumpId ? { dumpId: input.dumpId } : {})
        })
      )
  )

  registerTool(
    "analyze_abap_traces",
    {
      title: "Analyze ABAP Traces",
      description:
        "List SAP trace runs/configurations or inspect a trace summary, statements, or aggregated hit list.",
      inputSchema: {
        action: z.enum([
          "list_runs",
          "list_configurations",
          "analyze_run",
          "get_statements",
          "get_hitlist"
        ]),
        connectionId: z.string().min(1),
        traceId: z.string().min(1).optional(),
        maxResults: z.number().int().min(1).max(1000).default(20),
        includeDetails: z.boolean().default(false),
        startIndex: z.number().int().min(0).default(0)
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.analyzeTraces({
          action: input.action,
          connectionId: input.connectionId,
          maxResults: input.maxResults,
          includeDetails: input.includeDetails,
          startIndex: input.startIndex,
          ...(input.traceId ? { traceId: input.traceId } : {})
        })
      )
  )

  registerTool(
    "manage_heartbeat",
    {
      title: "Manage Heartbeat",
      description:
        "Manage an in-process monitoring watchlist, trigger safe SAP connection/query checks, and inspect history.",
      inputSchema: {
        action: z.enum([
          "status", "start", "stop", "trigger", "history", "add_task", "remove_task",
          "update_task", "enable_task", "disable_task", "list_tasks", "get_watchlist"
        ]),
        reason: z.string().optional(),
        count: z.number().int().min(1).max(500).optional(),
        description: z.string().min(1).optional(),
        condition: z.string().optional(),
        connectionId: z.string().min(1).optional(),
        removeWhenDone: z.boolean().optional(),
        sampleQuery: z.string().min(1).optional(),
        checkInstructions: z.array(z.string().min(1)).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        category: z.enum([
          "transport", "dump", "job", "idoc", "performance", "reminder", "custom"
        ]).optional(),
        alertThreshold: z.number().int().min(0).optional(),
        cooldownMinutes: z.number().int().min(0).optional(),
        expiresAt: z.iso.datetime().optional(),
        maxChecks: z.number().int().min(1).optional(),
        startAt: z.iso.datetime().optional(),
        reminderOnly: z.boolean().optional(),
        taskId: z.string().min(1).optional(),
        result: z.string().optional(),
        lastNotifiedAt: z.iso.datetime().optional(),
        lastNotifiedFindings: z.string().optional(),
        modifiedBy: z.enum(["user", "heartbeat", "agent"]).optional(),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(100).default(20),
        includeDetails: z.boolean().default(false)
      },
      annotations: analysisAnnotations
    },
    async input =>
      runTool(() =>
        tools.manageHeartbeat({
          action: input.action,
          startIndex: input.startIndex,
          maxResults: input.maxResults,
          includeDetails: input.includeDetails,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.count !== undefined ? { count: input.count } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.condition !== undefined ? { condition: input.condition } : {}),
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.removeWhenDone !== undefined ? { removeWhenDone: input.removeWhenDone } : {}),
          ...(input.sampleQuery ? { sampleQuery: input.sampleQuery } : {}),
          ...(input.checkInstructions ? { checkInstructions: input.checkInstructions } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.alertThreshold !== undefined ? { alertThreshold: input.alertThreshold } : {}),
          ...(input.cooldownMinutes !== undefined
            ? { cooldownMinutes: input.cooldownMinutes }
            : {}),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
          ...(input.maxChecks !== undefined ? { maxChecks: input.maxChecks } : {}),
          ...(input.startAt ? { startAt: input.startAt } : {}),
          ...(input.reminderOnly !== undefined ? { reminderOnly: input.reminderOnly } : {}),
          ...(input.taskId ? { taskId: input.taskId } : {}),
          ...(input.result !== undefined ? { result: input.result } : {}),
          ...(input.lastNotifiedAt ? { lastNotifiedAt: input.lastNotifiedAt } : {}),
          ...(input.lastNotifiedFindings !== undefined
            ? { lastNotifiedFindings: input.lastNotifiedFindings }
            : {}),
          ...(input.modifiedBy ? { modifiedBy: input.modifiedBy } : {})
        })
      )
  )

  registerTool(
    "adt_discovery_export",
    {
      title: "ADT Discovery Export",
      description:
        "Return an ADT capability summary, explicitly return full discovery data, or export it to a local JSON file.",
      inputSchema: {
        connectionId: z.string().min(1),
        mode: z.enum(["summary", "full", "file"]).default("summary")
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.exportAdtDiscovery(input.connectionId, input.mode))
  )

  const activationInputSchema = z.union([
    z.object({
      url: z.string().min(1),
      connectionId: z.string().min(1).optional()
    }).strict(),
    z.object({
      urls: z.array(z.string().min(1)).min(1).max(100),
      connectionId: z.string().min(1).optional()
    }).strict()
  ])

  registerTool(
    "abap_activate",
    {
      title: "Activate ABAP Object(s)",
      description: "Activate one legacy object or one same-connection batch of 1 through 100 ABAP objects.",
      inputSchema: activationInputSchema,
      annotations: writeAnnotations
    },
    async input => runTool(() => tools.activateObject(input as ActivateObjectInput))
  )

  registerTool(
    "replace_string_in_abap_object",
    {
      title: "Replace String in ABAP Object",
      description:
        "Replace exactly one source fragment, using a fresh read and an under-lock compare before saving. SAP syntax diagnostics are returned. Non-local packages require transport.",
      inputSchema: {
        fileUri: z.string().min(1),
        oldString: z.string(),
        newString: z.string(),
        connectionId: z.string().min(1).optional(),
        transport: z.string().min(1).optional(),
        activate: z.boolean().default(false)
      },
      annotations: writeAnnotations
    },
    async input =>
      runTool(() =>
        tools.replaceStringInObject({
          fileUri: input.fileUri,
          oldString: input.oldString,
          newString: input.newString,
          activate: input.activate,
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.transport ? { transport: input.transport } : {})
        })
      )
  )

  registerTool(
    "get_abap_diagnostics",
    {
      title: "Get ABAP Diagnostics",
      description:
        "Run SAP ADT syntax checking for the current source identified by an adt:// workspace URI or ADT path.",
      inputSchema: {
        fileUri: z.string().min(1),
        connectionId: z.string().min(1).optional(),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(1000).default(100),
        severity: z.string().min(1).optional()
      },
      annotations: readOnlyAnnotations
    },
    async input =>
      runTool(() =>
        tools.getAbapDiagnostics({
          fileUri: input.fileUri,
          startIndex: input.startIndex,
          maxResults: input.maxResults,
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.severity ? { severity: input.severity } : {})
        })
      )
  )

  registerTool(
    "inspect_abap_code",
    {
      title: "Inspect ABAP Code",
      description:
        "Use SAP ADT semantic services for completion, documentation, type hierarchy, components, definition, safe quick-fix discovery, or formatter preview. line is one-based and column is zero-based.",
      inputSchema: {
        action: z.enum([
          "completion",
          "definition",
          "quick_fixes",
          "format_preview",
          "completion_element",
          "documentation",
          "type_hierarchy",
          "components"
        ]),
        fileUri: z.string().min(1),
        connectionId: z.string().min(1).optional(),
        line: z.number().int().min(1).default(1),
        column: z.number().int().min(0).default(0),
        endColumn: z.number().int().min(0).optional(),
        implementation: z.boolean().default(false),
        superTypes: z.boolean().default(false),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.inspectCode({
      action: input.action,
      fileUri: input.fileUri,
      line: input.line,
      column: input.column,
      implementation: input.implementation,
      superTypes: input.superTypes,
      startIndex: input.startIndex,
      maxResults: input.maxResults,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.endColumn !== undefined ? { endColumn: input.endColumn } : {})
    }))
  )

  registerTool(
    "refactor_abap_code",
    {
      title: "Refactor ABAP Code",
      description:
        "Preview or execute SAP rename, package move, method extraction, quick-fix, formatting, or deletion. Execute only a fresh plan and copy its exact confirmation value.",
      inputSchema: {
        action: z.enum([
          "preview_rename",
          "preview_change_package",
          "preview_extract_method",
          "preview_quick_fix",
          "preview_format",
          "preview_delete",
          "execute"
        ]),
        fileUri: z.string().min(1).optional(),
        connectionId: z.string().min(1).optional(),
        line: z.number().int().min(1).optional(),
        column: z.number().int().min(0).optional(),
        endLine: z.number().int().min(1).optional(),
        endColumn: z.number().int().min(0).optional(),
        newName: z.string().min(1).optional(),
        newPackage: z.string().min(1).optional(),
        methodName: z.string().min(1).optional(),
        proposalIndex: z.number().int().min(0).optional(),
        transport: z.string().min(1).optional(),
        activate: z.boolean().default(false),
        planId: z.string().min(1).optional(),
        confirmation: z.string().min(1).optional()
      },
      annotations: writeAnnotations
    },
    async input => runTool(() => {
      if (input.action === "execute") {
        return tools.refactorCode({
          action: "execute",
          planId: input.planId ?? "",
          confirmation: input.confirmation ?? ""
        })
      }
      return tools.refactorCode({
        action: input.action,
        fileUri: input.fileUri ?? "",
        activate: input.activate,
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.column !== undefined ? { column: input.column } : {}),
        ...(input.endLine !== undefined ? { endLine: input.endLine } : {}),
        ...(input.endColumn !== undefined ? { endColumn: input.endColumn } : {}),
        ...(input.newName ? { newName: input.newName } : {}),
        ...(input.newPackage ? { newPackage: input.newPackage } : {}),
        ...(input.methodName ? { methodName: input.methodName } : {}),
        ...(input.proposalIndex !== undefined ? { proposalIndex: input.proposalIndex } : {}),
        ...(input.transport ? { transport: input.transport } : {})
      })
    })
  )

  registerTool(
    "manage_abapgit",
    {
      title: "Manage abapGit",
      description:
        "List, inspect, create, pull, unlink, stage, push, check, or switch abapGit repositories. Credentials come only from the secret store. Create confirmation is PACKAGE:CANONICAL_URL; other mutations use repositoryId.",
      inputSchema: {
        action: z.enum([
          "list_repositories", "remote_info", "create_repository", "pull_repository",
          "unlink_repository", "stage_repository", "push_repository", "check_repository",
          "switch_branch"
        ]),
        connectionId: z.string().min(1),
        repositoryId: z.string().min(1).optional(),
        repositoryUrl: z.url().optional(),
        packageName: z.string().min(1).optional(),
        branch: z.string().min(1).optional(),
        createBranch: z.boolean().default(false),
        transport: z.string().min(1).optional(),
        stageId: z.string().min(1).optional(),
        objectKeys: z.array(z.string().min(1)).max(1000).optional(),
        stageAll: z.boolean().default(false),
        comment: z.string().min(1).optional(),
        authorName: z.string().min(1).optional(),
        authorEmail: z.email().optional(),
        committerName: z.string().min(1).optional(),
        committerEmail: z.email().optional(),
        confirmation: z.string().min(1).optional(),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50)
      },
      annotations: writeAnnotations
    },
    async input => runTool(() => tools.manageAbapGit({
      action: input.action,
      connectionId: input.connectionId,
      createBranch: input.createBranch,
      stageAll: input.stageAll,
      startIndex: input.startIndex,
      maxResults: input.maxResults,
      ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
      ...(input.repositoryUrl ? { repositoryUrl: input.repositoryUrl } : {}),
      ...(input.packageName ? { packageName: input.packageName } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.transport ? { transport: input.transport } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.objectKeys ? { objectKeys: input.objectKeys } : {}),
      ...(input.comment ? { comment: input.comment } : {}),
      ...(input.authorName ? { authorName: input.authorName } : {}),
      ...(input.authorEmail ? { authorEmail: input.authorEmail } : {}),
      ...(input.committerName ? { committerName: input.committerName } : {}),
      ...(input.committerEmail ? { committerEmail: input.committerEmail } : {}),
      ...(input.confirmation ? { confirmation: input.confirmation } : {})
    }))
  )

  registerTool(
    "manage_rap_generator",
    {
      title: "Manage RAP Generator",
      description:
        "Check RAP availability, page schema, get defaults, validate, preview, generate, and manage service bindings. Generate confirms GENERATOR:BINDING; publish confirms BINDING; V2 unpublish confirms BINDING:SERVICE:VERSION.",
      inputSchema: {
        action: z.enum([
          "availability", "get_schema", "get_defaults", "validate", "preview", "generate",
          "publish", "unpublish", "service_details"
        ]),
        connectionId: z.string().min(1),
        generatorId: z.enum(["uiservice", "webapiservice"]).optional(),
        referenceObjectName: z.string().min(1).optional(),
        referenceObjectType: z.string().min(1).optional(),
        packageName: z.string().min(1).optional(),
        content: rapContentSchema.optional(),
        transport: z.string().min(1).optional(),
        serviceBindingName: z.string().min(1).optional(),
        serviceName: z.string().min(1).optional(),
        serviceVersion: z.string().min(1).optional(),
        confirmation: z.string().min(1).optional(),
        contentOffset: z.number().int().min(0).default(0),
        contentLength: z.number().int().min(1).max(50000).default(10000)
      },
      annotations: writeAnnotations
    },
    async input => runTool(() => tools.manageRap({
      action: input.action,
      connectionId: input.connectionId,
      contentOffset: input.contentOffset,
      contentLength: input.contentLength,
      ...(input.generatorId ? { generatorId: input.generatorId } : {}),
      ...(input.referenceObjectName ? { referenceObjectName: input.referenceObjectName } : {}),
      ...(input.referenceObjectType ? { referenceObjectType: input.referenceObjectType } : {}),
      ...(input.packageName ? { packageName: input.packageName } : {}),
      ...(input.content ? { content: input.content as RapGeneratorContent } : {}),
      ...(input.transport ? { transport: input.transport } : {}),
      ...(input.serviceBindingName ? { serviceBindingName: input.serviceBindingName } : {}),
      ...(input.serviceName ? { serviceName: input.serviceName } : {}),
      ...(input.serviceVersion ? { serviceVersion: input.serviceVersion } : {}),
      ...(input.confirmation ? { confirmation: input.confirmation } : {})
    }))
  )

  registerTool(
    "manage_abap_versions",
    {
      title: "Manage ABAP Inactive and Version Source",
      description:
        "List inactive objects, read inactive source, or preview and execute restoration of a historical source revision.",
      inputSchema: {
        action: z.enum(["list_inactive", "get_inactive_source", "preview_restore", "execute_restore"]),
        connectionId: z.string().min(1),
        objectName: z.string().min(1).optional(),
        objectType: z.string().min(1).optional(),
        versionNumber: z.number().int().min(1).optional(),
        planId: z.string().min(1).optional(),
        confirmation: z.string().min(1).optional(),
        transport: z.string().min(1).optional(),
        activate: z.boolean().default(false),
        startIndex: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(500).default(50),
        startLine: z.number().int().min(1).default(1),
        lineCount: z.number().int().min(1).max(5000).default(200)
      },
      annotations: writeAnnotations
    },
    async input => runTool(() => tools.manageVersions({
      action: input.action,
      connectionId: input.connectionId,
      activate: input.activate,
      startIndex: input.startIndex,
      maxResults: input.maxResults,
      startLine: input.startLine,
      lineCount: input.lineCount,
      ...(input.objectName ? { objectName: input.objectName } : {}),
      ...(input.objectType ? { objectType: input.objectType } : {}),
      ...(input.versionNumber !== undefined ? { versionNumber: input.versionNumber } : {}),
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.confirmation ? { confirmation: input.confirmation } : {}),
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  const runAbapApplicationSchema = z.discriminatedUnion("action", [
    z.object({
      action: z.literal("repl_health"),
      connectionId: z.string().min(1)
    }).strict(),
    z.object({
      action: z.literal("preview_class"),
      connectionId: z.string().min(1),
      className: z.string().min(1)
    }).strict(),
    z.object({
      action: z.literal("preview_snippet"),
      connectionId: z.string().min(1),
      code: z.string().min(1).max(98_304)
    }).strict(),
    z.object({
      action: z.literal("execute"),
      connectionId: z.string().min(1),
      planId: z.string().uuid(),
      confirmation: z.string().min(1)
    }).strict()
  ])
  const runAbapApplicationInputShape = {
    action: z.enum(["repl_health", "preview_class", "preview_snippet", "execute"]),
    connectionId: z.string().min(1),
    className: z.string().min(1).optional(),
    code: z.string().min(1).max(98_304).optional(),
    planId: z.string().uuid().optional(),
    confirmation: z.string().min(1).optional()
  }

  registerTool(
    "run_abap_application",
    {
      title: "Run ABAP Application",
      description:
        "Check the audited ABAP FS REPL or preview and execute a confirmed class/snippet plan.",
      inputSchema: runAbapApplicationInputShape,
      annotations: writeAnnotations
    },
    async input => runTool(() => tools.runAbapApplication(
      runAbapApplicationSchema.parse(input) as RunAbapApplicationInput
    ))
  )

  registerTool(
    "compare_abap_systems",
    {
      title: "Compare ABAP Across Systems",
      description: "Compare the same active ABAP object on two configured SAP systems with a bounded unified diff.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1).optional(),
        sourceConnectionId: z.string().min(1),
        targetConnectionId: z.string().min(1),
        ignoreWhitespace: z.boolean().default(false),
        maxPatchLines: z.number().int().min(1).max(2000).default(200)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.compareSystems({
      objectName: input.objectName,
      sourceConnectionId: input.sourceConnectionId,
      targetConnectionId: input.targetConnectionId,
      ignoreWhitespace: input.ignoreWhitespace,
      maxPatchLines: input.maxPatchLines,
      ...(input.objectType ? { objectType: input.objectType } : {})
    }))
  )

  registerTool(
    "get_abap_dependency_graph",
    {
      title: "Get ABAP Dependency Graph",
      description:
        "Build a bounded where-used dependency graph. Edges point from each dependent object to the object it uses.",
      inputSchema: {
        objectName: z.string().min(1),
        objectType: z.string().min(1).optional(),
        connectionId: z.string().min(1),
        line: z.number().int().min(1).optional(),
        column: z.number().int().min(0).optional(),
        depth: z.number().int().min(1).max(5).default(1),
        maxNodes: z.number().int().min(2).max(500).default(100),
        customOnly: z.boolean().default(false)
      },
      annotations: readOnlyAnnotations
    },
    async input => runTool(() => tools.dependencyGraph({
      objectName: input.objectName,
      connectionId: input.connectionId,
      depth: input.depth,
      maxNodes: input.maxNodes,
      customOnly: input.customOnly,
      ...(input.objectType ? { objectType: input.objectType } : {}),
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...(input.column !== undefined ? { column: input.column } : {})
    }))
  )

  registerTool(
    "run_sap_transaction",
    {
      title: "Run SAP Transaction",
      description:
        "Build a validated SAP WebGUI transaction URL, or launch it with the local default browser. Parameter values use a restricted injection-safe character set.",
      inputSchema: {
        connectionId: z.string().min(1),
        transactionCode: z.string().min(2),
        parameters: z.record(z.string(), z.string()).optional(),
        mode: z.enum(["url", "launch"]).default("url")
      },
      annotations: analysisAnnotations
    },
    async input => runTool(() => tools.runSapTransaction({
      connectionId: input.connectionId,
      transactionCode: input.transactionCode,
      mode: input.mode,
      ...(input.parameters ? { parameters: input.parameters } : {})
    }))
  )

  return server
}

export async function startStdioServer(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport())
}
