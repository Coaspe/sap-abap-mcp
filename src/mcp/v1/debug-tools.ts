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
import type { AbapToolService } from "../../tool-service.js"
import { V1_SCHEMA_VERSION } from "./contracts.js"
import { normalizeV1SystemId } from "./resource-uri.js"
import { runV1Tool, v1Success } from "./result.js"

const SYSTEM_ID = z.string().min(1)
const NON_EMPTY = z.string().min(1)

const debugOutputSchema = z.object({
  schemaVersion: z.literal(V1_SCHEMA_VERSION),
  requestId: z.string().min(1),
  status: z.literal("succeeded"),
  systemId: z.string().min(1).optional(),
  data: z.looseObject({}),
  warnings: z.array(z.never()).max(0)
})

const DEBUG_READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} satisfies ToolAnnotations

const DEBUG_CONTROL_ANNOTATIONS = {
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
  systemId: string,
  operation: (normalizedSystemId: string) => Promise<unknown>
) {
  return runV1Tool(async () => {
    const normalized = normalizeV1SystemId(systemId)
    const result = resultData(await operation(normalized))
    return v1Success(result.data, { systemId: normalized })
  })
}

export function registerV1DebugTools(
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
      outputSchema: debugOutputSchema,
      annotations
    }, callback)
  }

  const registerBreakpoint = (
    name: string,
    title: string,
    action: "set" | "remove"
  ) => registerTool(
    name,
    title,
    `${title} for one ADT source Resource.`,
    z.object({
      systemId: SYSTEM_ID,
      fileUri: NON_EMPTY,
      lineNumbers: z.array(z.number().int().min(1)).min(1),
      condition: NON_EMPTY.optional()
    }).strict(),
    DEBUG_CONTROL_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.manageDebugBreakpoint({
      connectionId: systemId,
      filePath: input.fileUri,
      lineNumbers: input.lineNumbers,
      action,
      ...(input.condition ? { condition: input.condition } : {})
    }))
  )

  registerBreakpoint(
    "sap.debug.breakpoint.remove",
    "Remove ABAP Debug Breakpoint",
    "remove"
  )
  registerBreakpoint(
    "sap.debug.breakpoint.set",
    "Set ABAP Debug Breakpoint",
    "set"
  )

  const variableOptions = {
    rowStart: z.number().int().min(0).default(0),
    rowCount: z.number().int().min(1).max(1000).default(50),
    filter: z.string().optional(),
    scopeName: NON_EMPTY.optional(),
    maxVariables: z.number().int().min(1).max(5000).default(100),
    filterPattern: NON_EMPTY.optional(),
    expandStructures: z.boolean().default(false),
    expandTables: z.boolean().default(false)
  }

  registerTool(
    "sap.debug.evaluate",
    "Evaluate ABAP Debug Expression",
    "Evaluate one expression in an attached debug stack frame.",
    z.object({
      systemId: SYSTEM_ID,
      frameId: z.number().int().min(1),
      expression: NON_EMPTY,
      ...variableOptions
    }).strict(),
    DEBUG_READ_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.getDebugVariables({
      connectionId: systemId,
      frameId: input.frameId,
      expression: input.expression,
      rowStart: input.rowStart,
      rowCount: input.rowCount,
      maxVariables: input.maxVariables,
      expandStructures: input.expandStructures,
      expandTables: input.expandTables,
      ...(input.filter !== undefined ? { filter: input.filter } : {}),
      ...(input.scopeName ? { scopeName: input.scopeName } : {}),
      ...(input.filterPattern ? { filterPattern: input.filterPattern } : {})
    }))
  )

  const registerSession = (
    name: string,
    title: string,
    action: "start" | "stop" | "status",
    annotations: ToolAnnotations
  ) => registerTool(
    name,
    title,
    `${title} through the stateful ADT debug client.`,
    z.object({
      systemId: SYSTEM_ID,
      debugUser: NON_EMPTY.optional(),
      terminalMode: z.boolean().default(false)
    }).strict(),
    annotations,
    input => serviceResult(input.systemId, systemId => service.manageDebugSession(
      systemId,
      action,
      input.debugUser,
      input.terminalMode
    ))
  )

  registerSession(
    "sap.debug.session.inspect",
    "Inspect ABAP Debug Session",
    "status",
    DEBUG_READ_ANNOTATIONS
  )
  registerSession(
    "sap.debug.session.start",
    "Start ABAP Debug Session",
    "start",
    DEBUG_CONTROL_ANNOTATIONS
  )
  registerSession(
    "sap.debug.session.stop",
    "Stop ABAP Debug Session",
    "stop",
    DEBUG_CONTROL_ANNOTATIONS
  )

  registerTool(
    "sap.debug.stack",
    "Read ABAP Debug Stack",
    "Read the current attached debuggee stack and stable frame IDs.",
    z.object({
      systemId: SYSTEM_ID,
      threadId: z.number().int().min(1).default(1)
    }).strict(),
    DEBUG_READ_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.getDebugStack(
      systemId,
      input.threadId
    ))
  )

  registerTool(
    "sap.debug.status",
    "Read ABAP Debug Status",
    "Read listener, debuggee attachment, and breakpoint state.",
    z.object({ systemId: SYSTEM_ID }).strict(),
    DEBUG_READ_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.getDebugStatus(systemId))
  )

  registerTool(
    "sap.debug.step",
    "Step ABAP Debuggee",
    "Continue or step an attached ABAP debuggee.",
    z.object({
      systemId: SYSTEM_ID,
      stepType: z.enum(["continue", "stepInto", "stepOver", "stepReturn", "jumpToLine"]),
      threadId: z.number().int().min(1).default(1),
      targetLine: z.number().int().min(1).optional()
    }).strict(),
    DEBUG_CONTROL_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.debugStep({
      connectionId: systemId,
      stepType: input.stepType,
      threadId: input.threadId,
      ...(input.targetLine !== undefined ? { targetLine: input.targetLine } : {})
    }))
  )

  registerTool(
    "sap.debug.variables",
    "Read ABAP Debug Variables",
    "Read variables from one attached debug stack frame.",
    z.object({
      systemId: SYSTEM_ID,
      frameId: z.number().int().min(1),
      variableName: NON_EMPTY.optional(),
      ...variableOptions
    }).strict(),
    DEBUG_READ_ANNOTATIONS,
    input => serviceResult(input.systemId, systemId => service.getDebugVariables({
      connectionId: systemId,
      frameId: input.frameId,
      rowStart: input.rowStart,
      rowCount: input.rowCount,
      maxVariables: input.maxVariables,
      expandStructures: input.expandStructures,
      expandTables: input.expandTables,
      ...(input.variableName ? { variableName: input.variableName } : {}),
      ...(input.filter !== undefined ? { filter: input.filter } : {}),
      ...(input.scopeName ? { scopeName: input.scopeName } : {}),
      ...(input.filterPattern ? { filterPattern: input.filterPattern } : {})
    }))
  )
}
