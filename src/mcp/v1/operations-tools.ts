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
import type { AbapToolService, HeartbeatInput } from "../../tool-service.js"
import { V1_SCHEMA_VERSION } from "./contracts.js"
import { normalizeV1SystemId } from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"

const SYSTEM_ID = z.string().min(1)
const NON_EMPTY = z.string().min(1)
const START_INDEX = z.number().int().min(0).default(0)

const operationsOutputSchema = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.literal("succeeded"),
  systemId: z.string().min(1).optional(),
  data: z.looseObject({}),
  warnings: z.array(z.never()).max(0)
})

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations

const CONTROL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
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

export function registerV1OperationsTools(
  server: McpServer,
  service: AbapToolService,
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
      outputSchema: operationsOutputSchema,
      annotations
    }, callback)
  }

  registerTool(
    "sap.execution.health",
    "Check ABAP Execution Health",
    "Check the configured ABAP REPL execution capability.",
    z.object({ systemId: SYSTEM_ID }).strict(),
    READ_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.runAbapApplication({
      action: "repl_health",
      connectionId: systemId!
    }))
  )

  registerTool(
    "sap.execution.preview",
    "Preview ABAP Execution",
    "Create a short-lived execution plan for a class or ABAP snippet.",
    z.discriminatedUnion("kind", [
      z.object({
        systemId: SYSTEM_ID,
        kind: z.literal("class"),
        className: NON_EMPTY
      }).strict(),
      z.object({
        systemId: SYSTEM_ID,
        kind: z.literal("snippet"),
        code: z.string().min(1).max(98304)
      }).strict()
    ]),
    CONTROL_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.runAbapApplication(
      input.kind === "class"
        ? {
            action: "preview_class",
            connectionId: systemId!,
            className: input.className
          }
        : {
            action: "preview_snippet",
            connectionId: systemId!,
            code: input.code
          }
    ))
  )

  const pagingShape = {
    startIndex: START_INDEX,
    limit: z.number().int().min(1).max(100).default(20),
    includeDetails: z.boolean().default(false)
  }
  const taskFields = {
    description: NON_EMPTY.optional(),
    condition: z.string().optional(),
    systemId: SYSTEM_ID.optional(),
    removeWhenDone: z.boolean().optional(),
    sampleQuery: NON_EMPTY.optional(),
    checkInstructions: z.array(NON_EMPTY).optional(),
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
    result: z.string().optional(),
    lastNotifiedAt: z.iso.datetime().optional(),
    lastNotifiedFindings: z.string().optional(),
    modifiedBy: z.enum(["user", "heartbeat", "agent"]).optional()
  }
  const watchResult = (
    input: Record<string, unknown>,
    action: HeartbeatInput["action"]
  ) => {
    const rawSystemId = typeof input.systemId === "string" ? input.systemId : undefined
    return serviceResult(rawSystemId, systemId => service.manageHeartbeat({
      action,
      startIndex: typeof input.startIndex === "number" ? input.startIndex : 0,
      maxResults: typeof input.limit === "number" ? input.limit : 20,
      includeDetails: input.includeDetails === true,
      ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
      ...(typeof input.count === "number" ? { count: input.count } : {}),
      ...(typeof input.description === "string"
        ? { description: input.description }
        : {}),
      ...(typeof input.condition === "string" ? { condition: input.condition } : {}),
      ...(systemId ? { connectionId: systemId } : {}),
      ...(typeof input.removeWhenDone === "boolean"
        ? { removeWhenDone: input.removeWhenDone }
        : {}),
      ...(typeof input.sampleQuery === "string" ? { sampleQuery: input.sampleQuery } : {}),
      ...(Array.isArray(input.checkInstructions)
        ? { checkInstructions: input.checkInstructions as string[] }
        : {}),
      ...(input.priority === "high" || input.priority === "medium" || input.priority === "low"
        ? { priority: input.priority }
        : {}),
      ...(typeof input.category === "string"
        ? { category: input.category as NonNullable<HeartbeatInput["category"]> }
        : {}),
      ...(typeof input.alertThreshold === "number"
        ? { alertThreshold: input.alertThreshold }
        : {}),
      ...(typeof input.cooldownMinutes === "number"
        ? { cooldownMinutes: input.cooldownMinutes }
        : {}),
      ...(typeof input.expiresAt === "string" ? { expiresAt: input.expiresAt } : {}),
      ...(typeof input.maxChecks === "number" ? { maxChecks: input.maxChecks } : {}),
      ...(typeof input.startAt === "string" ? { startAt: input.startAt } : {}),
      ...(typeof input.reminderOnly === "boolean"
        ? { reminderOnly: input.reminderOnly }
        : {}),
      ...(typeof input.taskId === "string" ? { taskId: input.taskId } : {}),
      ...(typeof input.result === "string" ? { result: input.result } : {}),
      ...(typeof input.lastNotifiedAt === "string"
        ? { lastNotifiedAt: input.lastNotifiedAt }
        : {}),
      ...(typeof input.lastNotifiedFindings === "string"
        ? { lastNotifiedFindings: input.lastNotifiedFindings }
        : {}),
      ...(input.modifiedBy === "user" || input.modifiedBy === "heartbeat" || input.modifiedBy === "agent"
        ? { modifiedBy: input.modifiedBy }
        : {})
    }))
  }

  const registerWatch = (
    name: string,
    title: string,
    action: HeartbeatInput["action"],
    schema: AnySchema,
    annotations: ToolAnnotations = READ_ANNOTATIONS
  ) => registerTool(
    name,
    title,
    `${title} through the in-process SAP watch service.`,
    schema,
    annotations,
    (input: unknown) => watchResult(input as Record<string, unknown>, action)
  )

  registerWatch(
    "sap.ops.watch.history",
    "Read SAP Watch History",
    "history",
    z.object({ count: z.number().int().min(1).max(500).optional(), ...pagingShape }).strict()
  )
  registerWatch(
    "sap.ops.watch.start",
    "Start SAP Watch",
    "start",
    z.object({}).strict(),
    CONTROL_ANNOTATIONS
  )
  registerWatch(
    "sap.ops.watch.status",
    "Read SAP Watch Status",
    "status",
    z.object({}).strict()
  )
  registerWatch(
    "sap.ops.watch.stop",
    "Stop SAP Watch",
    "stop",
    z.object({}).strict(),
    CONTROL_ANNOTATIONS
  )
  registerWatch(
    "sap.ops.watch.task.add",
    "Add SAP Watch Task",
    "add_task",
    z.object({ ...taskFields, description: NON_EMPTY, ...pagingShape }).strict(),
    CONTROL_ANNOTATIONS
  )

  const registerTaskControl = (
    name: string,
    title: string,
    action: "remove_task" | "enable_task" | "disable_task"
  ) => registerWatch(
    name,
    title,
    action,
    z.object({ taskId: NON_EMPTY, ...pagingShape }).strict(),
    CONTROL_ANNOTATIONS
  )
  registerTaskControl("sap.ops.watch.task.disable", "Disable SAP Watch Task", "disable_task")
  registerTaskControl("sap.ops.watch.task.enable", "Enable SAP Watch Task", "enable_task")
  registerWatch(
    "sap.ops.watch.task.list",
    "List SAP Watch Tasks",
    "list_tasks",
    z.object(pagingShape).strict()
  )
  registerTaskControl("sap.ops.watch.task.remove", "Remove SAP Watch Task", "remove_task")
  registerWatch(
    "sap.ops.watch.task.update",
    "Update SAP Watch Task",
    "update_task",
    z.object({ taskId: NON_EMPTY, ...taskFields, ...pagingShape }).strict(),
    CONTROL_ANNOTATIONS
  )
  registerWatch(
    "sap.ops.watch.trigger",
    "Trigger SAP Watch",
    "trigger",
    z.object({ reason: z.string().optional(), ...pagingShape }).strict(),
    CONTROL_ANNOTATIONS
  )
  registerWatch(
    "sap.ops.watch.watchlist.read",
    "Read SAP Watchlist",
    "get_watchlist",
    z.object(pagingShape).strict()
  )

  const dumpResult = (
    systemId: string,
    action: "list_dumps" | "analyze_dump",
    input: {
      dumpId?: string
      limit: number
      includeFullContent: boolean
      startIndex: number
      offset: number
      length: number
    }
  ) => serviceResult(systemId, normalized => service.analyzeDumps({
    action,
    connectionId: normalized!,
    maxResults: input.limit,
    includeFullContent: input.includeFullContent,
    startIndex: input.startIndex,
    contentOffset: input.offset,
    contentLength: input.length,
    ...(input.dumpId ? { dumpId: input.dumpId } : {})
  }))
  const dumpPagingShape = {
    limit: z.number().int().min(1).max(100).default(20),
    includeFullContent: z.boolean().default(false),
    startIndex: START_INDEX,
    offset: z.number().int().min(0).default(0),
    length: z.number().int().min(1).max(20000).default(4000)
  }

  registerTool(
    "sap.runtime.dump.inspect",
    "Inspect ABAP Runtime Dump",
    "Read and normalize one ABAP runtime dump.",
    z.object({ systemId: SYSTEM_ID, dumpId: NON_EMPTY, ...dumpPagingShape }).strict(),
    READ_ANNOTATIONS,
    input => dumpResult(input.systemId, "analyze_dump", input)
  )
  registerTool(
    "sap.runtime.dump.list",
    "List ABAP Runtime Dumps",
    "List a bounded page of ABAP runtime dumps.",
    z.object({ systemId: SYSTEM_ID, ...dumpPagingShape }).strict(),
    READ_ANNOTATIONS,
    input => dumpResult(input.systemId, "list_dumps", input)
  )

  const traceResult = (
    systemId: string,
    action: "list_runs" | "list_configurations" | "analyze_run" | "get_statements" | "get_hitlist",
    input: { traceId?: string; limit: number; includeDetails: boolean; startIndex: number }
  ) => serviceResult(systemId, normalized => service.analyzeTraces({
    action,
    connectionId: normalized!,
    maxResults: input.limit,
    includeDetails: input.includeDetails,
    startIndex: input.startIndex,
    ...(input.traceId ? { traceId: input.traceId } : {})
  }))
  const tracePagingShape = {
    limit: z.number().int().min(1).max(1000).default(20),
    includeDetails: z.boolean().default(false),
    startIndex: START_INDEX
  }
  const registerTrace = (
    name: string,
    title: string,
    action: "list_runs" | "list_configurations" | "analyze_run" | "get_statements" | "get_hitlist",
    needsTraceId: boolean
  ) => registerTool(
    name,
    title,
    `${title} through SAP ADT trace services.`,
    z.object({
      systemId: SYSTEM_ID,
      ...(needsTraceId ? { traceId: NON_EMPTY } : {}),
      ...tracePagingShape
    }).strict(),
    READ_ANNOTATIONS,
    input => traceResult(input.systemId as string, action, input as {
      traceId?: string
      limit: number
      includeDetails: boolean
      startIndex: number
    })
  )

  registerTrace("sap.runtime.trace.configuration", "List ABAP Trace Configurations", "list_configurations", false)
  registerTrace("sap.runtime.trace.hit_list", "Read ABAP Trace Hit List", "get_hitlist", true)
  registerTrace("sap.runtime.trace.inspect", "Inspect ABAP Trace", "analyze_run", true)
  registerTrace("sap.runtime.trace.list", "List ABAP Traces", "list_runs", false)
  registerTrace("sap.runtime.trace.statements", "Read ABAP Trace Statements", "get_statements", true)

  registerTool(
    "sap.system.discovery",
    "Read SAP ADT Discovery",
    "Read summary or full ADT discovery data for one configured SAP system.",
    z.object({
      systemId: SYSTEM_ID,
      detailLevel: z.enum(["summary", "full"]).default("summary")
    }).strict(),
    READ_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.exportAdtDiscovery(
      systemId!,
      input.detailLevel
    ))
  )

  const registerTransaction = (
    name: string,
    title: string,
    mode: "url" | "launch",
    annotations: ToolAnnotations
  ) => registerTool(
    name,
    title,
    `${title} for one validated SAP transaction.`,
    z.object({
      systemId: SYSTEM_ID,
      transactionCode: z.string().min(2),
      parameters: z.record(z.string(), z.string()).optional()
    }).strict(),
    annotations,
    input => serviceResult(input.systemId, systemId => service.runSapTransaction({
      connectionId: systemId!,
      transactionCode: input.transactionCode,
      mode,
      ...(input.parameters ? { parameters: input.parameters } : {})
    }))
  )
  registerTransaction(
    "sap.ui.transaction_launch",
    "Launch SAP Transaction",
    "launch",
    CONTROL_ANNOTATIONS
  )
  registerTransaction(
    "sap.ui.transaction_url",
    "Build SAP Transaction URL",
    "url",
    READ_ANNOTATIONS
  )
}
