import { randomUUID } from "node:crypto"
import {
  ErrorCode,
  McpError,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js"
import {
  isAdtError,
  isAdtException,
  isHttpError,
  isLoginError,
  type AdtException
} from "abap-adt-api"
import { z } from "zod"
import { AppError, errorPayload } from "../../errors.js"
import {
  V1_SCHEMA_VERSION,
  V1_ERROR_SCHEMA,
  V1_SUCCESS_SHAPE,
  type V1ErrorCategory
} from "./contracts.js"

const ERROR_DETAIL_BYTE_LIMIT = 8 * 1024
const DIAGNOSTIC_TEXT_BYTE_LIMIT = 512
const TRUNCATION_MARKER = "[TRUNCATED]"
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

const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "token",
  "password",
  "secret",
  "csrf",
  "session",
  "apikey"
] as const

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return SENSITIVE_KEY_PARTS.some(part => normalized.includes(part))
}

interface SensitiveAssignment {
  valueStart: number
  valueEnd: number
  replacement: string
}

function isAssignmentKeyCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character)
}

function isAssignmentWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character)
}

function findSensitiveAssignment(
  value: string,
  start: number
): SensitiveAssignment | undefined {
  if (start > 0 && isAssignmentKeyCharacter(value[start - 1])) return undefined

  let index = start
  const keyQuote = value[index] === '"' || value[index] === "'"
    ? value[index++]
    : undefined
  const keyStart = index
  while (isAssignmentKeyCharacter(value[index])) index += 1
  if (index === keyStart) return undefined

  const key = value.slice(keyStart, index)
  if (keyQuote !== undefined) {
    if (value[index] !== keyQuote) return undefined
    index += 1
  }

  let multiline = false
  while (isAssignmentWhitespace(value[index])) {
    multiline ||= value[index] === "\r" || value[index] === "\n"
    index += 1
  }
  const delimiter = value[index]
  if (delimiter !== ":" && delimiter !== "=") return undefined
  index += 1
  while (isAssignmentWhitespace(value[index])) {
    multiline ||= value[index] === "\r" || value[index] === "\n"
    index += 1
  }
  if (!isSensitiveKey(key)) return undefined

  const valueStart = index
  const valueQuote = value[index]
  if (valueQuote === '"' || valueQuote === "'") {
    let closed = false
    index += 1
    while (index < value.length) {
      const character = value[index]
      if (character === "\r" || character === "\n") break
      if (character === "\\") {
        index += 1
        if (value[index] === "\r" || value[index] === "\n") break
      } else if (character === valueQuote) {
        index += 1
        closed = true
        break
      }
      index += 1
    }

    return {
      valueStart,
      valueEnd: multiline || !closed ? value.length : index,
      replacement: `${valueQuote}[REDACTED]${closed ? valueQuote : ""}`
    }
  }

  const scheme = value.slice(index, index + 6).toLowerCase()
  const schemeLength = scheme.startsWith("basic")
    ? 5
    : scheme.startsWith("bearer")
      ? 6
      : 0
  if (schemeLength > 0 && isAssignmentWhitespace(value[index + schemeLength])) {
    index += schemeLength
    let folded = false
    while (isAssignmentWhitespace(value[index])) {
      folded ||= value[index] === "\r" || value[index] === "\n"
      index += 1
    }
    if (multiline || folded) {
      return { valueStart, valueEnd: value.length, replacement: "[REDACTED]" }
    }
    while (
      index < value.length &&
      !isAssignmentWhitespace(value[index]) &&
      !",;&#}]".includes(value[index] ?? "")
    ) index += 1
    let lineEnd = index
    while (lineEnd < value.length && value[lineEnd] !== "\r" && value[lineEnd] !== "\n") {
      lineEnd += 1
    }
    let continuationStart = lineEnd
    if (value[continuationStart] === "\r") continuationStart += 1
    if (value[continuationStart] === "\n") continuationStart += 1
    if (value[continuationStart] === " " || value[continuationStart] === "\t") {
      return { valueStart, valueEnd: value.length, replacement: "[REDACTED]" }
    }
    if (delimiter === "=") {
      return { valueStart, valueEnd: index, replacement: "[REDACTED]" }
    }
    index = lineEnd
  }

  if (multiline) {
    return { valueStart, valueEnd: value.length, replacement: "[REDACTED]" }
  }
  if (delimiter === ":") {
    while (index < value.length && value[index] !== "\r" && value[index] !== "\n") {
      index += 1
    }
    return { valueStart, valueEnd: index, replacement: "[REDACTED]" }
  }
  while (
    index < value.length &&
    !isAssignmentWhitespace(value[index]) &&
    !",;&#}]".includes(value[index] ?? "")
  ) index += 1
  return { valueStart, valueEnd: index, replacement: "[REDACTED]" }
}

function redactSensitiveAssignments(value: string): string {
  let cursor = 0
  let result = ""

  for (let start = 0; start < value.length; start += 1) {
    const assignment = findSensitiveAssignment(value, start)
    if (assignment === undefined) continue

    result += value.slice(cursor, assignment.valueStart) + assignment.replacement
    cursor = assignment.valueEnd
    start = Math.max(start, assignment.valueEnd - 1)
  }

  return result + value.slice(cursor)
}

function redactSensitiveText(value: string): string {
  const userinfoRedacted = value.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s?#]*@/gi,
    "$1[REDACTED]@"
  )
  const schemeRedacted = userinfoRedacted.replace(
    /\b(Basic|Bearer)\s+[^\s,;&#}\]]+(?:\r?\n[ \t]+[^\r\n,;&#}\]]+)*/gi,
    "$1 [REDACTED]"
  )
  return redactSensitiveAssignments(schemeRedacted)
}

function truncateUtf8(value: string, byteLimit: number): string {
  if (Buffer.byteLength(value, "utf8") <= byteLimit) return value

  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8")
  let bytes = 0
  let preview = ""
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8")
    if (bytes + characterBytes + markerBytes > byteLimit) break
    preview += character
    bytes += characterBytes
  }
  return preview + TRUNCATION_MARKER
}

export function sanitizeV1Message(value: string): string {
  const redacted = redactSensitiveText(value)
  const originalWasOversized = Buffer.byteLength(value, "utf8") > DIAGNOSTIC_TEXT_BYTE_LIMIT
  const redactedFits = Buffer.byteLength(redacted, "utf8") <= DIAGNOSTIC_TEXT_BYTE_LIMIT
  return truncateUtf8(
    originalWasOversized && redactedFits ? redacted + TRUNCATION_MARKER : redacted,
    DIAGNOSTIC_TEXT_BYTE_LIMIT
  )
}

function stripRepeatedMcpPrefix(message: string, code: number): string {
  const prefix = `MCP error ${code}: `
  while (message.startsWith(prefix)) message = message.slice(prefix.length)
  return message
}

export function toV1ProtocolError(
  error: unknown,
  fallbackMessage = "Operation failed"
): McpError {
  const raw = error instanceof McpError
    ? stripRepeatedMcpPrefix(error.message, error.code)
    : error instanceof Error
      ? error.message
      : String(error)
  const message = sanitizeV1Message(raw) || fallbackMessage
  const code = error instanceof McpError
    ? error.code
    : error instanceof AppError && error.code === "INVALID_ADT_URI"
      ? ErrorCode.InvalidParams
      : ErrorCode.InternalError
  const converted = new McpError(code, message)
  converted.message = message
  return converted
}

function sanitizeDiagnosticValue(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) return undefined
  if (typeof value === "string") return sanitizeV1Message(value)
  if (typeof value === "bigint") return String(value)
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"

  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map(item => sanitizeDiagnosticValue(item, seen))
    seen.delete(value)
    return result
  }

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const redacted = isSensitiveKey(key)
      ? "[REDACTED]"
      : sanitizeDiagnosticValue(child, seen)
    if (redacted !== undefined) result[key] = redacted
  }
  seen.delete(value)
  return result
}

function sanitizeV1DiagnosticValue(value: unknown): unknown {
  return sanitizeDiagnosticValue(value, new WeakSet())
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
  const candidate = sanitizeV1DiagnosticValue(details)
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

function adtHttpStatus(error: AdtException): number | undefined {
  if (isHttpError(error)) return error.status > 0 ? error.status : undefined
  if (isAdtError(error)) {
    const status = error.response?.status ?? error.err
    return status > 0 ? status : undefined
  }
  return undefined
}

function normalizeV1Error(error: unknown): unknown {
  if (error instanceof AppError || !isAdtException(error)) return error

  const httpStatus = adtHttpStatus(error)
  const details = httpStatus === undefined ? undefined : { httpStatus }
  if (httpStatus === 401 || isLoginError(error)) {
    return new AppError("AUTH_REQUIRED", error.message, details)
  }
  if (httpStatus === 403) {
    return new AppError("SAP_AUTHORIZATION_DENIED", error.message, details)
  }
  return new AppError("SAP_OPERATION_FAILED", error.message, details)
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
    warnings: (options.warnings ?? []).map(warning => ({
      ...warning,
      message: sanitizeV1Message(warning.message)
    })),
    ...(options.evidence !== undefined
      ? { evidence: sanitizeV1DiagnosticValue(options.evidence) }
      : {}),
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
  const normalizedError = normalizeV1Error(error)
  const payload = errorPayload(normalizedError)
  const code = typeof payload.code === "string" && payload.code.length > 0
    ? payload.code
    : "INTERNAL_ERROR"
  const redactedMessage = typeof payload.message === "string"
    ? sanitizeV1Message(payload.message)
    : ""
  const message = redactedMessage.length > 0
    ? redactedMessage
    : "Internal operation failed"
  const category = normalizedError instanceof AppError
    ? ERROR_CATEGORIES[code] ?? "internal"
    : "internal"
  const retryable = normalizedError instanceof AppError &&
    normalizedError.code === "SAP_OPERATION_FAILED" &&
    RETRYABLE_SAP_STATUSES.has(normalizedError.details?.httpStatus as number)
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
