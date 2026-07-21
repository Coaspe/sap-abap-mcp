import {
  McpServer,
  type ToolCallback
} from "@modelcontextprotocol/sdk/server/mcp.js"
import type {
  AnySchema,
  ZodRawShapeCompat
} from "@modelcontextprotocol/sdk/server/zod-compat.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { RapGeneratorContent } from "abap-adt-api"
import type { AbapToolService } from "../../tool-service.js"
import { V1_SCHEMA_VERSION } from "./contracts.js"
import { normalizeV1SystemId } from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"

const SYSTEM_ID = z.string().min(1)
const NON_EMPTY = z.string().min(1)
const START_INDEX = z.number().int().min(0).default(0)
const MAX_RESULTS = z.number().int().min(1).max(500).default(50)

const analysisOutputSchema = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.literal("succeeded"),
  systemId: z.string().min(1).optional(),
  data: z.looseObject({}),
  warnings: z.array(z.never()).max(0)
})

const ANALYSIS_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations

const rapContentSchema = z.object({
  metadata: z.object({
    package: NON_EMPTY,
    masterLanguage: NON_EMPTY.optional()
  }).strict().optional(),
  general: z.object({
    referenceObjectName: NON_EMPTY.optional(),
    description: z.string()
  }).strict(),
  businessObject: z.object({
    dataModelEntity: z.object({
      cdsName: NON_EMPTY,
      entityName: NON_EMPTY.optional()
    }).strict(),
    behavior: z.object({
      implementationType: NON_EMPTY,
      implementationClass: NON_EMPTY,
      draftTable: z.string()
    }).strict()
  }).strict(),
  serviceProjection: z.object({ name: NON_EMPTY }).strict(),
  businessService: z.object({
    serviceDefinition: z.object({ name: NON_EMPTY }).strict(),
    serviceBinding: z.object({
      name: NON_EMPTY,
      bindingType: NON_EMPTY
    }).strict()
  }).strict()
}).strict()

function resultData(result: unknown): {
  data: Record<string, unknown>
  systemId?: string
} {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("The shared service returned a non-object result")
  }
  const { connectionId, ...data } = result as Record<string, unknown>
  return {
    data,
    ...(typeof connectionId === "string" && connectionId.length > 0
      ? { systemId: connectionId.toUpperCase() }
      : {})
  }
}

async function serviceResult(
  systemId: string | undefined,
  operation: (normalizedSystemId: string | undefined) => Promise<unknown>
) {
  return runV1Tool(async () => {
    const normalized = systemId === undefined
      ? undefined
      : normalizeV1SystemId(systemId)
    const result = resultData(await operation(normalized))
    const envelopeSystemId = normalized ?? result.systemId
    return v1Success(result.data, {
      ...(envelopeSystemId ? { systemId: envelopeSystemId } : {})
    })
  })
}

export function registerV1AnalysisTools(
  server: McpServer,
  service: AbapToolService,
  selected?: ReadonlySet<string>
): void {
  const registerTool = <InputArgs extends ZodRawShapeCompat | AnySchema>(
    name: string,
    title: string,
    description: string,
    inputSchema: InputArgs,
    callback: ToolCallback<InputArgs>
  ) => {
    if (selected && !selected.has(name)) return
    server.registerTool(name, {
      title,
      description,
      inputSchema,
      outputSchema: analysisOutputSchema,
      annotations: ANALYSIS_ANNOTATIONS
    }, callback)
  }

  registerTool(
    "sap.data.query",
    "Query SAP Data",
    "Run one bounded read-only SAP ADT data-preview query.",
    z.object({
      systemId: SYSTEM_ID,
      sql: NON_EMPTY.optional(),
      data: z.object({
        columns: z.array(z.object({
          name: NON_EMPTY,
          type: NON_EMPTY,
          description: z.string().optional()
        }).strict()).min(1),
        values: z.array(z.record(z.string(), z.unknown()))
      }).strict().optional(),
      displayMode: z.enum(["internal", "ui"]).default("internal"),
      webviewId: NON_EMPTY.optional(),
      title: NON_EMPTY.optional(),
      maxRows: z.number().int().min(1).max(50000).default(1000),
      rowRange: z.object({
        start: z.number().int().min(0),
        end: z.number().int().min(1)
      }).strict().optional(),
      sortColumns: z.array(z.object({
        column: NON_EMPTY,
        direction: z.enum(["asc", "desc"])
      }).strict()).optional(),
      filters: z.array(z.object({
        column: NON_EMPTY,
        value: z.string()
      }).strict()).optional(),
      resetSorting: z.boolean().optional(),
      resetFilters: z.boolean().optional()
    }).strict().refine(input => {
      const sourceCount = Number(input.sql !== undefined) + Number(input.data !== undefined)
      return sourceCount <= 1 && (sourceCount === 1 || input.webviewId !== undefined)
    }, { message: "Provide at most one of sql or data, or webviewId for a cached result" }),
    input => serviceResult(input.systemId, systemId => service.executeDataQuery({
      connectionId: systemId!,
      displayMode: input.displayMode,
      maxRows: input.maxRows,
      ...(input.sql ? { sql: input.sql } : {}),
      ...(input.data ? {
        data: {
          columns: input.data.columns.map(column => ({
            name: column.name,
            type: column.type,
            ...(column.description !== undefined
              ? { description: column.description }
              : {})
          })),
          values: input.data.values
        }
      } : {}),
      ...(input.webviewId ? { webviewId: input.webviewId } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.rowRange
        ? { rowRange: input.rowRange }
        : input.displayMode === "internal"
          ? { rowRange: { start: 0, end: Math.min(100, input.maxRows) } }
          : {}),
      ...(input.sortColumns ? { sortColumns: input.sortColumns } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
      ...(input.resetSorting !== undefined ? { resetSorting: input.resetSorting } : {}),
      ...(input.resetFilters !== undefined ? { resetFilters: input.resetFilters } : {})
    }))
  )

  const registerGitRead = (
    name: string,
    title: string,
    action: "check_repository" | "remote_info" | "list_repositories",
    extraShape: Record<string, z.ZodType> = {}
  ) => registerTool(
    name,
    title,
    `${title} through the shared abapGit capability.`,
    z.object({
      systemId: SYSTEM_ID,
      ...extraShape,
      startIndex: START_INDEX,
      limit: MAX_RESULTS
    }).strict(),
    input => {
      const values = input as Record<string, unknown>
      return serviceResult(values.systemId as string, systemId => service.manageAbapGit({
        action,
        connectionId: systemId!,
        startIndex: values.startIndex as number,
        maxResults: values.limit as number,
        ...(typeof values.repositoryId === "string"
          ? { repositoryId: values.repositoryId }
          : {}),
        ...(typeof values.repositoryUrl === "string"
          ? { repositoryUrl: values.repositoryUrl }
          : {})
      }))
    }
  )

  registerGitRead("sap.git.check", "Check abapGit Repository", "check_repository", {
    repositoryId: NON_EMPTY
  })
  registerGitRead("sap.git.inspect", "Inspect abapGit Repository", "remote_info", {
    repositoryUrl: z.url()
  })
  registerGitRead("sap.git.list", "List abapGit Repositories", "list_repositories")

  registerTool(
    "sap.quality.atc.cached",
    "Read Cached ATC Findings",
    "Read a bounded page of cached ATC findings.",
    z.object({
      fileUri: NON_EMPTY.optional(),
      startIndex: START_INDEX,
      limit: MAX_RESULTS
    }).strict(),
    input => serviceResult(undefined, async () => service.getAtcDecorations(
      input.fileUri,
      input.startIndex,
      input.limit
    ))
  )

  registerTool(
    "sap.quality.atc.documentation",
    "Read ATC Documentation",
    "Read a bounded section of documentation for an ATC finding.",
    z.object({
      systemId: SYSTEM_ID,
      docUri: NON_EMPTY,
      offset: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(20000).default(4000)
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.runAtcAnalysis({
      action: "get_documentation",
      connectionId: systemId!,
      docUri: input.docUri,
      startIndex: 0,
      maxResults: 50,
      documentationOffset: input.offset,
      documentationLength: input.length
    }))
  )

  registerTool(
    "sap.quality.atc.run",
    "Run ATC Analysis",
    "Run the system ATC check variant for one exact object.",
    z.object({
      systemId: SYSTEM_ID,
      objectName: NON_EMPTY.optional(),
      objectType: NON_EMPTY.optional(),
      objectUri: NON_EMPTY.optional(),
      startIndex: START_INDEX,
      limit: MAX_RESULTS
    }).strict().refine(input => input.objectName !== undefined || input.objectUri !== undefined, {
      message: "objectName or objectUri is required"
    }),
    input => serviceResult(input.systemId, systemId => service.runAtcAnalysis({
      action: "run_analysis",
      connectionId: systemId!,
      startIndex: input.startIndex,
      maxResults: input.limit,
      documentationOffset: 0,
      documentationLength: 4000,
      ...(input.objectName ? { objectName: input.objectName } : {}),
      ...(input.objectType ? { objectType: input.objectType } : {}),
      ...(input.objectUri ? { objectUri: input.objectUri } : {})
    }))
  )

  registerTool(
    "sap.quality.unit_test",
    "Run ABAP Unit Tests",
    "Run ABAP Unit for one exact repository object.",
    z.object({
      systemId: SYSTEM_ID,
      objectName: NON_EMPTY,
      detailLevel: z.enum(["summary", "failures", "all"]).default("failures")
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.runUnitTests(
      input.objectName,
      systemId!,
      input.detailLevel
    ))
  )

  const rapBaseShape = {
    systemId: SYSTEM_ID,
    generatorId: z.enum(["uiservice", "webapiservice"]),
    referenceObjectName: NON_EMPTY,
    referenceObjectType: NON_EMPTY.optional(),
    packageName: NON_EMPTY,
    offset: z.number().int().min(0).default(0),
    length: z.number().int().min(1).max(50000).default(10000)
  }
  const registerRapRead = (
    name: string,
    title: string,
    action: "availability" | "get_schema" | "get_defaults" | "validate" | "preview",
    contentRequired = false
  ) => registerTool(
    name,
    title,
    `${title} through the shared RAP generator capability.`,
    z.object({
      ...rapBaseShape,
      ...(contentRequired ? { content: rapContentSchema } : {})
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action,
      connectionId: systemId!,
      generatorId: input.generatorId,
      referenceObjectName: input.referenceObjectName,
      packageName: input.packageName,
      contentOffset: input.offset,
      contentLength: input.length,
      ...(input.referenceObjectType
        ? { referenceObjectType: input.referenceObjectType }
        : {}),
      ...(contentRequired
        ? { content: input.content as RapGeneratorContent }
        : {})
    }))
  )

  registerTool(
    "sap.rap.availability",
    "Check RAP Generator Availability",
    "Check one RAP generator on a configured SAP system.",
    z.object({
      systemId: SYSTEM_ID,
      generatorId: z.enum(["uiservice", "webapiservice"])
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action: "availability",
      connectionId: systemId!,
      generatorId: input.generatorId,
      contentOffset: 0,
      contentLength: 10000
    }))
  )

  registerTool(
    "sap.rap.binding.inspect",
    "Inspect RAP Service Binding",
    "Inspect one RAP service binding.",
    z.object({
      systemId: SYSTEM_ID,
      serviceBindingName: NON_EMPTY,
      offset: z.number().int().min(0).default(0),
      length: z.number().int().min(1).max(50000).default(10000)
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action: "service_details",
      connectionId: systemId!,
      serviceBindingName: input.serviceBindingName,
      contentOffset: input.offset,
      contentLength: input.length
    }))
  )

  registerRapRead("sap.rap.defaults", "Get RAP Defaults", "get_defaults")
  registerRapRead("sap.rap.preview", "Preview RAP Generation", "preview", true)
  registerRapRead("sap.rap.schema", "Get RAP Schema", "get_schema")
  registerTool(
    "sap.rap.validate",
    "Validate RAP Content",
    "Validate RAP initial inputs and optional generated content.",
    z.object({
      ...rapBaseShape,
      content: rapContentSchema.optional()
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.manageRap({
      action: "validate",
      connectionId: systemId!,
      generatorId: input.generatorId,
      referenceObjectName: input.referenceObjectName,
      packageName: input.packageName,
      contentOffset: input.offset,
      contentLength: input.length,
      ...(input.referenceObjectType
        ? { referenceObjectType: input.referenceObjectType }
        : {}),
      ...(input.content ? { content: input.content as RapGeneratorContent } : {})
    }))
  )

  registerTool(
    "sap.refactor.preview",
    "Preview ABAP Refactoring",
    "Preview one ABAP refactoring plan without changing SAP source.",
    z.object({
      systemId: SYSTEM_ID.optional(),
      fileUri: NON_EMPTY,
      kind: z.enum(["rename", "change_package", "extract_method", "quick_fix", "format", "delete"]),
      line: z.number().int().min(1).optional(),
      column: z.number().int().min(0).optional(),
      endLine: z.number().int().min(1).optional(),
      endColumn: z.number().int().min(0).optional(),
      newName: NON_EMPTY.optional(),
      newPackage: NON_EMPTY.optional(),
      methodName: NON_EMPTY.optional(),
      proposalIndex: z.number().int().min(0).optional(),
      transport: NON_EMPTY.optional(),
      activate: z.boolean().default(false)
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.refactorCode({
      action: `preview_${input.kind}`,
      fileUri: input.fileUri,
      activate: input.activate,
      ...(systemId ? { connectionId: systemId } : {}),
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...(input.column !== undefined ? { column: input.column } : {}),
      ...(input.endLine !== undefined ? { endLine: input.endLine } : {}),
      ...(input.endColumn !== undefined ? { endColumn: input.endColumn } : {}),
      ...(input.newName ? { newName: input.newName } : {}),
      ...(input.newPackage ? { newPackage: input.newPackage } : {}),
      ...(input.methodName ? { methodName: input.methodName } : {}),
      ...(input.proposalIndex !== undefined
        ? { proposalIndex: input.proposalIndex }
        : {}),
      ...(input.transport ? { transport: input.transport } : {})
    }))
  )

  registerTool(
    "sap.repository.compare",
    "Compare ABAP Across Systems",
    "Compare the same active object across two configured SAP systems.",
    z.object({
      sourceSystemId: SYSTEM_ID,
      targetSystemId: SYSTEM_ID,
      objectName: NON_EMPTY,
      objectType: NON_EMPTY.optional(),
      ignoreWhitespace: z.boolean().default(false),
      maxPatchLines: z.number().int().min(1).max(2000).default(200)
    }).strict(),
    input => serviceResult(input.sourceSystemId, sourceSystemId => service.compareSystems({
      sourceConnectionId: sourceSystemId!,
      targetConnectionId: normalizeV1SystemId(input.targetSystemId),
      objectName: input.objectName,
      ignoreWhitespace: input.ignoreWhitespace,
      maxPatchLines: input.maxPatchLines,
      ...(input.objectType ? { objectType: input.objectType } : {})
    }))
  )

  registerTool(
    "sap.repository.dependency_graph",
    "Build ABAP Dependency Graph",
    "Build a bounded where-used dependency graph.",
    z.object({
      systemId: SYSTEM_ID,
      objectName: NON_EMPTY,
      objectType: NON_EMPTY.optional(),
      line: z.number().int().min(1).optional(),
      column: z.number().int().min(0).optional(),
      depth: z.number().int().min(1).max(5).default(1),
      maxNodes: z.number().int().min(2).max(500).default(100),
      customOnly: z.boolean().default(false)
    }).strict(),
    input => serviceResult(input.systemId, systemId => service.dependencyGraph({
      connectionId: systemId!,
      objectName: input.objectName,
      depth: input.depth,
      maxNodes: input.maxNodes,
      customOnly: input.customOnly,
      ...(input.objectType ? { objectType: input.objectType } : {}),
      ...(input.line !== undefined ? { line: input.line } : {}),
      ...(input.column !== undefined ? { column: input.column } : {})
    }))
  )

  const transportBaseShape = {
    systemId: SYSTEM_ID,
    startIndex: START_INDEX,
    limit: MAX_RESULTS
  }
  const transportResult = (
    input: Record<string, unknown>,
    action: "assess_transport" | "compare_transports" | "get_transport_details" |
      "get_transport_objects" | "get_user_transports" | "resolve_object" | "list_system_users"
  ) => serviceResult(input.systemId as string, systemId => service.manageTransportRequests({
    action,
    connectionId: systemId!,
    startIndex: input.startIndex as number,
    maxResults: input.limit as number,
    includeObjects: input.includeObjects === true,
    ...(typeof input.transportNumber === "string"
      ? { transportNumber: input.transportNumber }
      : {}),
    ...(Array.isArray(input.transportNumbers)
      ? { transportNumbers: input.transportNumbers as string[] }
      : {}),
    ...(typeof input.user === "string" ? { user: input.user } : {}),
    ...(typeof input.objectType === "string"
      ? { objectType: input.objectType }
      : {}),
    ...(typeof input.pgmid === "string" ? { pgmid: input.pgmid } : {}),
    ...(typeof input.objectName === "string"
      ? { objectName: input.objectName }
      : {}),
    ...(Array.isArray(input.checks)
      ? { checks: input.checks as Array<"atc" | "unit_tests" | "target_compare"> }
      : {}),
    ...(typeof input.targetSystemId === "string"
      ? { targetConnectionId: normalizeV1SystemId(input.targetSystemId) }
      : {}),
    ...(typeof input.failOnAtcWarnings === "boolean"
      ? { failOnAtcWarnings: input.failOnAtcWarnings }
      : {}),
    ...(typeof input.maxObjects === "number" ? { maxObjects: input.maxObjects } : {}),
    ...(Array.isArray(input.reportFormats)
      ? { reportFormats: input.reportFormats as Array<"json" | "sarif" | "junit"> }
      : {}),
    ...(typeof input.reportDirectory === "string"
      ? { reportDirectory: input.reportDirectory }
      : {})
  }))

  registerTool(
    "sap.transport.assess",
    "Assess SAP Transport",
    "Run bounded change-assurance checks for one transport.",
    z.object({
      ...transportBaseShape,
      transportNumber: NON_EMPTY,
      checks: z.array(z.enum(["atc", "unit_tests", "target_compare"]))
        .min(1).max(3).default(["atc", "unit_tests"]),
      targetSystemId: SYSTEM_ID.optional(),
      failOnAtcWarnings: z.boolean().default(false),
      maxObjects: z.number().int().min(1).max(200).default(20),
      reportFormats: z.array(z.enum(["json", "sarif", "junit"]))
        .min(1).max(3).default(["json"]),
      reportDirectory: NON_EMPTY.optional()
    }).strict(),
    input => transportResult(input, "assess_transport")
  )

  registerTool(
    "sap.transport.compare",
    "Compare SAP Transports",
    "Compare two to ten transport requests.",
    z.object({
      ...transportBaseShape,
      transportNumbers: z.array(NON_EMPTY).min(2).max(10)
    }).strict(),
    input => transportResult(input, "compare_transports")
  )

  registerTool(
    "sap.transport.inspect",
    "Inspect SAP Transport",
    "Read details or objects for one transport request.",
    z.object({
      ...transportBaseShape,
      transportNumber: NON_EMPTY,
      view: z.enum(["details", "objects"]).default("details"),
      includeObjects: z.boolean().default(false)
    }).strict(),
    input => transportResult(
      input,
      input.view === "objects" ? "get_transport_objects" : "get_transport_details"
    )
  )

  registerTool(
    "sap.transport.list",
    "List SAP Transports",
    "List a bounded page of user transports.",
    z.object({ ...transportBaseShape, user: NON_EMPTY.optional() }).strict(),
    input => transportResult(input, "get_user_transports")
  )

  registerTool(
    "sap.transport.object.resolve",
    "Resolve SAP Transport Object",
    "Resolve one SAP repository object to a transport key.",
    z.object({
      ...transportBaseShape,
      transportNumber: NON_EMPTY.optional(),
      pgmid: NON_EMPTY,
      objectType: NON_EMPTY,
      objectName: NON_EMPTY
    }).strict(),
    input => transportResult(input, "resolve_object")
  )

  registerTool(
    "sap.transport.user.list",
    "List SAP System Users",
    "List a bounded page of transport-capable SAP users.",
    z.object(transportBaseShape).strict(),
    input => transportResult(input, "list_system_users")
  )

  const historyBaseShape = {
    systemId: SYSTEM_ID,
    objectName: NON_EMPTY,
    objectType: NON_EMPTY.optional(),
    maxVersions: z.number().int().min(1).max(200).default(20),
    startIndex: START_INDEX,
    limit: z.number().int().min(1).max(1000).default(200),
    startLine: z.number().int().min(1).default(1),
    lineCount: z.number().int().min(1).max(5000).default(200)
  }
  const historyResult = (
    input: Record<string, unknown>,
    action: "list_versions" | "get_version_source" | "compare_versions"
  ) => serviceResult(input.systemId as string, systemId => service.getVersionHistory({
    action,
    connectionId: systemId!,
    objectName: input.objectName as string,
    maxVersions: input.maxVersions as number,
    startIndex: input.startIndex as number,
    maxResults: input.limit as number,
    startLine: input.startLine as number,
    lineCount: input.lineCount as number,
    ...(typeof input.objectType === "string" ? { objectType: input.objectType } : {}),
    ...(typeof input.versionNumber === "number"
      ? { versionNumber: input.versionNumber }
      : {}),
    ...(typeof input.version1 === "number" ? { version1: input.version1 } : {}),
    ...(typeof input.version2 === "number" ? { version2: input.version2 } : {})
  }))

  registerTool(
    "sap.version.history.compare",
    "Compare ABAP Versions",
    "Compare two historical source revisions.",
    z.object({
      ...historyBaseShape,
      version1: z.number().int().min(1),
      version2: z.number().int().min(1)
    }).strict(),
    input => historyResult(input, "compare_versions")
  )
  registerTool(
    "sap.version.history.list",
    "List ABAP Versions",
    "List historical revisions for one object.",
    z.object(historyBaseShape).strict(),
    input => historyResult(input, "list_versions")
  )
  registerTool(
    "sap.version.history.read",
    "Read ABAP Version",
    "Read a bounded source range from one historical revision.",
    z.object({
      ...historyBaseShape,
      versionNumber: z.number().int().min(1)
    }).strict(),
    input => historyResult(input, "get_version_source")
  )

  const versionsBaseShape = {
    systemId: SYSTEM_ID,
    objectName: NON_EMPTY.optional(),
    objectType: NON_EMPTY.optional(),
    startIndex: START_INDEX,
    limit: MAX_RESULTS,
    startLine: z.number().int().min(1).default(1),
    lineCount: z.number().int().min(1).max(5000).default(200)
  }
  const versionsResult = (
    input: Record<string, unknown>,
    action: "list_inactive" | "get_inactive_source" | "preview_restore"
  ) => serviceResult(input.systemId as string, systemId => service.manageVersions({
    action,
    connectionId: systemId!,
    activate: input.activate === true,
    startIndex: input.startIndex as number,
    maxResults: input.limit as number,
    startLine: input.startLine as number,
    lineCount: input.lineCount as number,
    ...(typeof input.objectName === "string" ? { objectName: input.objectName } : {}),
    ...(typeof input.objectType === "string" ? { objectType: input.objectType } : {}),
    ...(typeof input.transport === "string" ? { transport: input.transport } : {}),
    ...(typeof input.versionNumber === "number"
      ? { versionNumber: input.versionNumber }
      : {})
  }))

  registerTool(
    "sap.version.inactive.list",
    "List Inactive ABAP Objects",
    "List a bounded page of inactive objects.",
    z.object(versionsBaseShape).strict(),
    input => versionsResult(input, "list_inactive")
  )
  registerTool(
    "sap.version.inactive.read",
    "Read Inactive ABAP Source",
    "Read a bounded inactive-source range.",
    z.object({ ...versionsBaseShape, objectName: NON_EMPTY }).strict(),
    input => versionsResult(input, "get_inactive_source")
  )
  registerTool(
    "sap.version.restore.preview",
    "Preview ABAP Version Restore",
    "Preview restoration of one historical revision.",
    z.object({
      ...versionsBaseShape,
      objectName: NON_EMPTY,
      versionNumber: z.number().int().min(1),
      transport: NON_EMPTY.optional(),
      activate: z.boolean().default(false)
    }).strict(),
    input => versionsResult(input, "preview_restore")
  )
}
