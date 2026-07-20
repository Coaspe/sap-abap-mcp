import { randomUUID } from "node:crypto"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { AppError, errorPayload } from "../../errors.js"
import {
  V1_SCHEMA_VERSION,
  type V1ErrorCategory
} from "./contracts.js"

const ERROR_DETAIL_BYTE_LIMIT = 8 * 1024

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
  const redacted = value.replace(
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
    result[key] = isSensitiveKey(key)
      ? "[REDACTED]"
      : redactValue(child, seen)
  }
  seen.delete(value)
  return result
}

function boundedDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(details, new WeakSet()) as Record<string, unknown>
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
  const envelope: Record<string, unknown> = {
    schemaVersion: V1_SCHEMA_VERSION,
    requestId: options.requestId ?? randomUUID(),
    status: options.status ?? "succeeded",
    ...(options.systemId !== undefined ? { systemId: options.systemId } : {}),
    data,
    warnings: options.warnings ?? [],
    ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    ...(options.page !== undefined ? { page: options.page } : {})
  }
  const links = (options.resourceLinks ?? []).map(link => ({
    type: "resource_link" as const,
    uri: link.uri,
    name: link.name,
    ...(link.description !== undefined ? { description: link.description } : {}),
    ...(link.mimeType !== undefined ? { mimeType: link.mimeType } : {})
  }))

  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }, ...links],
    structuredContent: envelope
  }
}

export function v1Failure(error: unknown, requestId = randomUUID()): CallToolResult {
  const payload = errorPayload(error)
  const category = error instanceof AppError
    ? ERROR_CATEGORIES[payload.code] ?? "internal"
    : "internal"
  const retryable = error instanceof AppError &&
    error.code === "SAP_OPERATION_FAILED" &&
    RETRYABLE_SAP_STATUSES.has(error.details?.httpStatus as number)
  const envelope: Record<string, unknown> = {
    schemaVersion: V1_SCHEMA_VERSION,
    requestId,
    code: payload.code,
    category,
    message: redactSensitiveText(payload.message),
    retryable,
    ...(payload.details ? { details: boundedDetails(payload.details) } : {})
  }

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
