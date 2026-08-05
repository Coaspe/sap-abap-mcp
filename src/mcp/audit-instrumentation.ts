import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import {
  classifyAuditOutcome,
  type AuditRecorder
} from "../audit-log.js"

const UNKNOWN_ERROR_CODE = "UNKNOWN_ERROR"

interface ToolConfigLike {
  inputSchema?: unknown
  annotations?: ToolAnnotations
}

type AnyCallback = (...args: unknown[]) => unknown

interface InstrumentableServer {
  registerTool: (
    name: string,
    config: ToolConfigLike,
    callback: AnyCallback
  ) => unknown
  registerResource: (
    name: string,
    uriOrTemplate: unknown,
    config: unknown,
    readCallback: AnyCallback
  ) => unknown
}

function textOfFirstContent(result: unknown): string | undefined {
  if (result === null || typeof result !== "object") return undefined
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  const first = content[0]
  if (first === null || typeof first !== "object") return undefined
  const text = (first as { text?: unknown }).text
  return typeof text === "string" ? text : undefined
}

function codeOf(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.code === "string" && record.code.length > 0) {
    return record.code
  }
  const nested = record.error
  if (nested !== null && typeof nested === "object") {
    const nestedCode = (nested as { code?: unknown }).code
    if (typeof nestedCode === "string" && nestedCode.length > 0) return nestedCode
  }
  return undefined
}

/**
 * Read the machine-readable error code from a failed tool result. Covers the v0
 * error payload, the v1 error envelope, and the deferred `compact-v1` envelope
 * that carries the code under `error`.
 */
export function extractToolErrorCode(result: unknown): string | undefined {
  if (result === null || typeof result !== "object") return undefined
  if ((result as { isError?: unknown }).isError !== true) return undefined
  const structured = codeOf((result as { structuredContent?: unknown }).structuredContent)
  if (structured !== undefined) return structured
  const text = textOfFirstContent(result)
  if (text === undefined) return UNKNOWN_ERROR_CODE
  try {
    return codeOf(JSON.parse(text)) ?? UNKNOWN_ERROR_CODE
  } catch {
    return UNKNOWN_ERROR_CODE
  }
}

function sessionFields(extra: unknown): {
  sessionId?: string
  requestId?: string
} {
  if (extra === null || typeof extra !== "object") return {}
  const record = extra as Record<string, unknown>
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : undefined
  const rawRequestId = record.requestId
  const requestId = typeof rawRequestId === "string"
    ? rawRequestId
    : typeof rawRequestId === "number"
      ? String(rawRequestId)
      : undefined
  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(requestId !== undefined ? { requestId } : {})
  }
}

function elapsedMs(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1000n) / 1000
}

function uriString(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value instanceof URL) return value.href
  return undefined
}

/**
 * Wrap `registerTool` and `registerResource` on one `McpServer` instance so that
 * every tool call and resource read emits exactly one audit event. This is the
 * single choke point: all v0 and v1 capabilities register through these two
 * methods, so no registration site needs to know about auditing.
 *
 * Call this before registering capabilities.
 */
export function instrumentAudit(
  server: McpServer,
  recorder: AuditRecorder
): void {
  if (!recorder.enabled) return
  const target = server as unknown as InstrumentableServer
  const originalRegisterTool = target.registerTool.bind(target)
  const originalRegisterResource = target.registerResource.bind(target)

  target.registerTool = (name, config, callback) => {
    const annotations = config?.annotations
    const mutation = annotations?.readOnlyHint !== true
    const destructive = annotations?.destructiveHint === true
    // The SDK passes `(input, extra)` when an input schema is declared and
    // `(extra)` when it is not. See McpServer.executeToolHandler.
    const hasInputSchema = config?.inputSchema !== undefined
    const wrapped: AnyCallback = async (...args) => {
      const startedAt = process.hrtime.bigint()
      const toolArguments = hasInputSchema ? args[0] : undefined
      const extra = hasInputSchema ? args[1] : args[0]
      const finish = (outcome: Parameters<typeof recorder.record>[0]["outcome"],
        errorCode?: string) => {
        recorder.record({
          kind: "tool",
          name,
          mutation,
          destructive,
          outcome,
          durationMs: elapsedMs(startedAt),
          arguments: toolArguments,
          ...(errorCode !== undefined ? { errorCode } : {}),
          ...sessionFields(extra)
        })
      }
      try {
        const result = await callback(...args)
        const errorCode = extractToolErrorCode(result)
        finish(classifyAuditOutcome(errorCode), errorCode)
        return result
      } catch (error) {
        const code = error !== null && typeof error === "object" &&
          typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : UNKNOWN_ERROR_CODE
        finish(classifyAuditOutcome(code), code)
        throw error
      }
    }
    return originalRegisterTool(name, config, wrapped)
  }

  target.registerResource = (name, uriOrTemplate, config, readCallback) => {
    const wrapped: AnyCallback = async (...args) => {
      const startedAt = process.hrtime.bigint()
      const uri = uriString(args[0])
      const extra = args[args.length - 1]
      const finish = (outcome: Parameters<typeof recorder.record>[0]["outcome"],
        errorCode?: string) => {
        recorder.record({
          kind: "resource",
          name,
          mutation: false,
          destructive: false,
          outcome,
          durationMs: elapsedMs(startedAt),
          ...(uri !== undefined ? { uri } : {}),
          ...(errorCode !== undefined ? { errorCode } : {}),
          ...sessionFields(extra)
        })
      }
      try {
        const result = await readCallback(...args)
        finish("succeeded")
        return result
      } catch (error) {
        const code = error !== null && typeof error === "object" &&
          typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : UNKNOWN_ERROR_CODE
        finish(classifyAuditOutcome(code), code)
        throw error
      }
    }
    return originalRegisterResource(name, uriOrTemplate, config, wrapped)
  }
}
