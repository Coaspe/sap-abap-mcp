import { randomUUID } from "node:crypto"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { AppError, errorPayload } from "../../errors.js"
import {
  V1_SCHEMA_VERSION,
  V1_ERROR_SCHEMA,
  V1_SUCCESS_SHAPE,
  type V1ErrorCategory
} from "./contracts.js"

const ERROR_DETAIL_BYTE_LIMIT = 8 * 1024
const V1_SUCCESS_SCHEMA = z.object({
  ...V1_SUCCESS_SHAPE,
  data: z.record(z.string(), z.unknown())
})

const ERROR_CATEGORIES: Readonly<Record<string, V1ErrorCategory>> = {
  AUTH_REQUIRED: "authentication",
  OAUTH_CLIENT_CREDENTIALS_REQUIRED: "authentication",
  SAP_AUTHORIZATION_DENIED: "authorization",
  PROFILE_NOT_ALLOWED: "policy",
  PRODUCTION_DATA_BLOCKED: "policy",
  PRODUCTION_WRITE_BLOCKED: "policy",
  PACKAGE_NOT_ALLOWED: "policy",
  OBJECT_CHANGED: "conflict",
  SOURCE_CHANGED: "conflict",
  CONNECTION_MISMATCH: "conflict",
  OBJECT_AMBIGUOUS: "conflict",
  SAP_CAPABILITY_UNAVAILABLE: "capability",
  SAP_VALIDATION_FAILED: "validation",
  OBJECT_NOT_FOUND: "validation",
  METHOD_NOT_FOUND: "validation",
  INVALID_ADT_URI: "validation",
  SAP_OPERATION_FAILED: "sap",
  SOURCE_READ_FAILED: "sap",
  CANCELLED: "transport"
}

const RETRYABLE_SAP_STATUSES = new Set([429, 502, 503, 504])

export interface V1SuccessOptions {
  requestId?: string
  status?: "succeeded" | "partial"
  systemId?: string
  warnings?: Array<{ code: string; message: string }>
  evidence?: Record<string, unknown>
  page?: { nextCursor?: string; returned: number; total?: number }
  resourceLinks?: Array<{
    uri: string
    name: string
    description?: string
    mimeType?: string
  }>
}

function redactSensitiveHeaders(value: string): string {
  return value.replace(
    /(^|[^a-z0-9-])(x-csrf-token|set-cookie|authorization|cookie)(\s*:\s*)[^\r\n]*/gi,
    (_match, prefix, header, delimiter) =>
      `${prefix}${header}${delimiter}[REDACTED]`
  )
}

function redactSensitiveText(value: string): string {
  const bearerRedacted = value.replace(
    /\bBearer\s+[^\s,;&#}\]]+/gi,
    "Bearer [REDACTED]"
  )
  const redacted = bearerRedacted.replace(
    /(^|[^a-z0-9_-])(["']?)(x-csrf-token|set-cookie|access_token|refresh_token|csrf[-_]token|session_id|password|authorization|token|cookie|csrf|session)\2(\s*[:=]\s*)(?:(["'])([\s\S]*?)\5|((?:Bearer\s+)?[^\s,;&#}\]]+))/gi,
    (_match, prefix, labelQuote, label, delimiter, valueQuote) =>
      `${prefix}${labelQuote}${label}${labelQuote}${delimiter}` +
      (valueQuote ? `${valueQuote}[REDACTED]${valueQuote}` : "[REDACTED]")
  )
  return redactSensitiveHeaders(redacted)
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|token|password|secret|csrf|session/i.test(key)
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) return undefined
  if (typeof value === "string") return redactSensitiveText(value)
  if (typeof value === "bigint") return String(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"

  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map(item => redactValue(item, seen))
    seen.delete(value)
    return result
  }

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const redacted = isSensitiveKey(key)
      ? "[REDACTED]"
      : redactValue(child, seen)
    if (redacted !== undefined) result[key] = redacted
  }
  seen.delete(value)
  return result
}

function invalidSuccessResult(): never {
  throw new AppError(
    "V1_RESULT_INVALID",
    "v1 success result does not match its declared schema"
  )
}

function canonicalSuccess(
  candidate: Record<string, unknown>
): { envelope: Record<string, unknown>; text: string } {
  let jsonSafe: unknown
  try {
    jsonSafe = JSON.parse(JSON.stringify(candidate)) as unknown
  } catch {
    return invalidSuccessResult()
  }

  const parsed = V1_SUCCESS_SCHEMA.safeParse(jsonSafe)
  if (!parsed.success) return invalidSuccessResult()
  const envelope: Record<string, unknown> = parsed.data
  return { envelope, text: JSON.stringify(envelope) }
}

function boundedDetails(details: Record<string, unknown>): Record<string, unknown> {
  const candidate = redactValue(details, new WeakSet())
  const redacted = candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {}
  const serialized = JSON.stringify(redacted)
  const originalBytes = Buffer.byteLength(serialized, "utf8")
  if (originalBytes <= ERROR_DETAIL_BYTE_LIMIT) return redacted

  const characters = Array.from(serialized)
  let low = 0
  let high = characters.length
  let result: Record<string, unknown> = { truncated: true, originalBytes }

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = {
      truncated: true,
      originalBytes,
      preview: characters.slice(0, middle).join("")
    }
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= ERROR_DETAIL_BYTE_LIMIT) {
      result = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}

export function v1Success(
  data: Record<string, unknown>,
  options: V1SuccessOptions = {}
): CallToolResult {
  const candidate: Record<string, unknown> = {
    schemaVersion: V1_SCHEMA_VERSION,
    requestId: options.requestId ?? randomUUID(),
    status: options.status ?? "succeeded",
    ...(options.systemId !== undefined ? { systemId: options.systemId } : {}),
    data,
    warnings: options.warnings ?? [],
    ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    ...(options.page !== undefined ? { page: options.page } : {})
  }
  const { envelope, text } = canonicalSuccess(candidate)
  const links = (options.resourceLinks ?? []).map(link => ({
    type: "resource_link" as const,
    uri: link.uri,
    name: link.name,
    ...(link.description !== undefined ? { description: link.description } : {}),
    ...(link.mimeType !== undefined ? { mimeType: link.mimeType } : {})
  }))

  return {
    content: [{ type: "text", text }, ...links],
    structuredContent: envelope
  }
}

export function v1Failure(error: unknown, requestId?: string): CallToolResult {
  const payload = errorPayload(error)
  const code = typeof payload.code === "string" && payload.code.length > 0
    ? payload.code
    : "INTERNAL_ERROR"
  const redactedMessage = typeof payload.message === "string"
    ? redactSensitiveText(payload.message)
    : ""
  const message = redactedMessage.length > 0
    ? redactedMessage
    : "Internal operation failed"
  const category = error instanceof AppError
    ? ERROR_CATEGORIES[code] ?? "internal"
    : "internal"
  const retryable = error instanceof AppError &&
    error.code === "SAP_OPERATION_FAILED" &&
    RETRYABLE_SAP_STATUSES.has(error.details?.httpStatus as number)
  const envelope = V1_ERROR_SCHEMA.parse({
    schemaVersion: V1_SCHEMA_VERSION,
    requestId: typeof requestId === "string" && requestId.length > 0
      ? requestId
      : randomUUID(),
    code,
    category,
    message,
    retryable,
    ...(payload.details ? { details: boundedDetails(payload.details) } : {})
  })

  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    isError: true
  }
}

export async function runV1Tool(
  operation: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await operation()
  } catch (error) {
    return v1Failure(error)
  }
}
