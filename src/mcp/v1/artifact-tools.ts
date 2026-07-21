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
import { MERMAID_DIAGRAM_TYPES } from "../../mermaid-tools.js"
import type { AbapToolService } from "../../tool-service.js"
import { V1_SCHEMA_VERSION } from "./contracts.js"
import type { V1EvidenceStore } from "./evidence-store.js"
import { normalizeV1SystemId } from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"

const SYSTEM_ID = z.string().min(1)
const NON_EMPTY = z.string().min(1)

const artifactOutputSchema = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.literal("succeeded"),
  systemId: z.string().min(1).optional(),
  data: z.looseObject({ evidenceUri: z.string().min(1) }),
  warnings: z.array(z.never()).max(0)
})

const ARTIFACT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations

const OVERWRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
} satisfies ToolAnnotations

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

async function artifactResult(
  evidenceStore: V1EvidenceStore,
  artifact: string,
  systemId: string | undefined,
  operation: (normalizedSystemId: string | undefined) => Promise<unknown>
) {
  return runV1Tool(async () => {
    const normalized = systemId === undefined
      ? undefined
      : normalizeV1SystemId(systemId)
    const result = resultData(await operation(normalized))
    const envelopeSystemId = normalized ?? result.systemId
    const evidenceUri = evidenceStore.put(artifact, {
      ...(envelopeSystemId ? { systemId: envelopeSystemId } : {}),
      ...result.data
    })
    return v1Success({ ...result.data, evidenceUri }, {
      ...(envelopeSystemId ? { systemId: envelopeSystemId } : {}),
      resourceLinks: [{
        uri: evidenceUri,
        name: `${artifact} evidence`,
        description: "Read the bounded session-owned artifact evidence.",
        mimeType: "application/json"
      }]
    })
  })
}

export function registerV1ArtifactTools(
  server: McpServer,
  service: AbapToolService,
  evidenceStore: V1EvidenceStore,
  selected?: ReadonlySet<string>
): void {
  const registerTool = <InputArgs extends ZodRawShapeCompat | AnySchema>(
    name: string,
    title: string,
    description: string,
    inputSchema: InputArgs,
    annotations: ToolAnnotations,
    callback: ToolCallback<InputArgs>
  ) => {
    if (selected && !selected.has(name)) return
    server.registerTool(name, {
      title,
      description,
      inputSchema,
      outputSchema: artifactOutputSchema,
      annotations
    }, callback)
  }

  const mermaidCodeSchema = z.object({
    code: NON_EMPTY,
    diagramType: z.enum([...MERMAID_DIAGRAM_TYPES, "auto"]).default("auto"),
    theme: z.enum(["default", "dark", "forest", "neutral"]).default("forest")
  }).strict()

  registerTool(
    "sap.artifact.mermaid.create",
    "Create Mermaid Artifact",
    "Validate Mermaid code and create an interactive local HTML artifact.",
    mermaidCodeSchema,
    ARTIFACT_ANNOTATIONS,
    input => artifactResult(evidenceStore, "mermaid-create", undefined, () =>
      service.createMermaidDiagram(input.code, input.diagramType, input.theme)
    )
  )

  registerTool(
    "sap.artifact.mermaid.detect",
    "Detect Mermaid Diagram Type",
    "Parse Mermaid code and detect its normalized diagram type.",
    z.object({ code: NON_EMPTY }).strict(),
    READ_ANNOTATIONS,
    input => artifactResult(evidenceStore, "mermaid-detect", undefined, () =>
      service.detectMermaidDiagramType(input.code)
    )
  )

  registerTool(
    "sap.artifact.mermaid.validate",
    "Validate Mermaid Syntax",
    "Parse Mermaid code without rendering it.",
    z.object({
      code: NON_EMPTY,
      suppressErrors: z.boolean().default(true)
    }).strict(),
    READ_ANNOTATIONS,
    input => artifactResult(evidenceStore, "mermaid-validate", undefined, () =>
      service.validateMermaidSyntax(input.code, input.suppressErrors)
    )
  )

  registerTool(
    "sap.artifact.test_document.create",
    "Create Test Documentation",
    "Create a styled DOCX report from test scenarios and screenshots.",
    z.object({
      scenarios: z.array(z.object({
        scenarioId: z.number().int().min(1),
        scenarioName: NON_EMPTY,
        scenarioDescription: NON_EMPTY,
        screenshots: z.array(z.object({
          filePath: NON_EMPTY,
          description: NON_EMPTY
        }).strict())
      }).strict()).min(1),
      reportTitle: NON_EMPTY.optional(),
      testDate: z.string().regex(/^\d{2}-\d{2}-\d{4}$/).optional()
    }).strict(),
    ARTIFACT_ANNOTATIONS,
    input => artifactResult(evidenceStore, "test-document", undefined, () =>
      service.createTestDocumentation({
        scenarios: input.scenarios,
        ...(input.reportTitle ? { reportTitle: input.reportTitle } : {}),
        ...(input.testDate ? { testDate: input.testDate } : {})
      })
    )
  )

  const dataSourceSchema = z.object({
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
    webviewId: NON_EMPTY.optional(),
    title: NON_EMPTY.optional(),
    maxRows: z.number().int().min(1).max(50000).default(1000),
    sortColumns: z.array(z.object({
      column: NON_EMPTY,
      direction: z.enum(["asc", "desc"])
    }).strict()).optional(),
    filters: z.array(z.object({ column: NON_EMPTY, value: z.string() }).strict()).optional(),
    resetSorting: z.boolean().optional(),
    resetFilters: z.boolean().optional(),
    filePath: NON_EMPTY,
    fileType: z.enum(["xlsx", "csv"])
  }).strict().refine(input => {
    const sourceCount = Number(input.sql !== undefined) + Number(input.data !== undefined)
    return sourceCount <= 1 && (sourceCount === 1 || input.webviewId !== undefined)
  }, { message: "Provide at most one of sql or data, or webviewId for a cached result" })

  registerTool(
    "sap.data.export",
    "Export SAP Data",
    "Export one read-only data query or cached data view to CSV or XLSX.",
    dataSourceSchema,
    OVERWRITE_ANNOTATIONS,
    input => artifactResult(evidenceStore, "data-export", input.systemId, systemId =>
      service.executeDataQuery({
        connectionId: systemId!,
        displayMode: "download_to_file",
        maxRows: input.maxRows,
        filePath: input.filePath,
        fileType: input.fileType,
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
        ...(input.sortColumns ? { sortColumns: input.sortColumns } : {}),
        ...(input.filters ? { filters: input.filters } : {}),
        ...(input.resetSorting !== undefined ? { resetSorting: input.resetSorting } : {}),
        ...(input.resetFilters !== undefined ? { resetFilters: input.resetFilters } : {})
      })
    )
  )

  registerTool(
    "sap.source.export",
    "Export ABAP Source",
    "Download one ABAP object or package to an absolute local folder.",
    z.object({
      systemId: SYSTEM_ID.optional(),
      source: NON_EMPTY,
      target: NON_EMPTY,
      objectType: NON_EMPTY.optional(),
      overwrite: z.boolean().default(false),
      includeFileList: z.boolean().default(false)
    }).strict(),
    OVERWRITE_ANNOTATIONS,
    input => artifactResult(evidenceStore, "source-export", input.systemId, systemId =>
      service.downloadAbap({
        source: input.source,
        target: input.target,
        overwrite: input.overwrite,
        includeFileList: input.includeFileList,
        ...(systemId ? { connectionId: systemId } : {}),
        ...(input.objectType ? { objectType: input.objectType } : {})
      })
    )
  )

  registerTool(
    "sap.system.discovery.export",
    "Export SAP ADT Discovery",
    "Export full ADT discovery data to a temporary JSON artifact.",
    z.object({ systemId: SYSTEM_ID }).strict(),
    ARTIFACT_ANNOTATIONS,
    input => artifactResult(evidenceStore, "discovery-export", input.systemId, systemId =>
      service.exportAdtDiscovery(systemId!, "file")
    )
  )
}
