import { createHash, randomUUID } from "node:crypto"
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { userInfo } from "node:os"
import { stderr } from "node:process"
import { AppError } from "./errors.js"

export const AUDIT_SCHEMA_VERSION = "sap-abap-mcp.audit/v1"

export const AUDIT_SINK_NAMES = ["none", "stderr", "file"] as const
export type AuditSinkName = (typeof AUDIT_SINK_NAMES)[number]

export type AuditOutcome = "succeeded" | "failed" | "denied"

export type AuditPrincipalSource =
  | "local-process"
  | "api-key"
  | "oidc"
  | "unknown"

/**
 * Error codes raised when a guardrail refuses an operation rather than when SAP
 * or the network fails. These are recorded as `denied` so that an operator can
 * count blocked attempts separately from technical failures.
 */
export const AUDIT_POLICY_DENIAL_CODES: ReadonlySet<string> = new Set([
  "AUTH_REQUIRED",
  "CONFIRMATION_MISMATCH",
  "DATA_QUERY_CONFIRMATION_REQUIRED",
  "DATA_QUERY_NOT_ALLOWED",
  "DATA_QUERY_SOURCE_UNRESOLVED",
  "DATA_QUERY_TABLE_DENIED",
  "GIT_STAGE_EXPIRED",
  "INVALID_TRANSACTION_CODE",
  "INVALID_TRANSACTION_PARAMETER",
  "OAUTH_CLIENT_CREDENTIALS_REQUIRED",
  "PACKAGE_NOT_ALLOWED",
  "PACKAGE_UNKNOWN",
  "PLAN_EXPIRED",
  "PRODUCTION_DATA_BLOCKED",
  "PRODUCTION_WRITE_BLOCKED",
  "PROFILE_NOT_ALLOWED",
  "QUERY_NOT_READ_ONLY",
  "SAP_AUTHORIZATION_DENIED",
  "TRANSPORT_REQUIRED"
])

const SENSITIVE_KEY_PARTS = [
  "apikey",
  "authorization",
  "bearer",
  "certificate",
  "cookie",
  "credential",
  "csrf",
  "passphrase",
  "password",
  "privatekey",
  "secret",
  "session",
  "sql",
  "token"
] as const

const SYSTEM_ID_KEYS = ["systemId", "connectionId"] as const

const TARGET_KEY_GROUPS = {
  objectName: ["objectName", "name"],
  objectType: ["objectType", "type"],
  objectUri: ["fileUri", "objectUri", "sourceUri", "uri"],
  package: ["package", "packageName", "targetPackage"],
  transport: ["transport", "transportNumber", "transportRequest"],
  method: ["method", "methodName"]
} as const

export const AUDIT_ARGUMENT_STRING_BYTE_LIMIT = 512
export const AUDIT_ARGUMENT_TOTAL_BYTE_LIMIT = 4 * 1024
const AUDIT_ARGUMENT_ARRAY_LIMIT = 20
const AUDIT_ARGUMENT_DEPTH_LIMIT = 6
const REDACTED = "[redacted]"

export interface AuditPrincipal {
  id: string
  source: AuditPrincipalSource
}

export interface AuditTarget {
  objectName?: string
  objectType?: string
  objectUri?: string
  package?: string
  transport?: string
  method?: string
}

/**
 * `session` events describe the HTTP transport itself — authentication,
 * session lifecycle, and rate limiting — rather than a SAP capability call.
 */
export type AuditCapabilityKind = "tool" | "resource" | "session"

export interface AuditEvent {
  schema: typeof AUDIT_SCHEMA_VERSION
  eventId: string
  timestamp: string
  principal: AuditPrincipal
  apiVersion: string
  kind: AuditCapabilityKind
  name: string
  /** True when the capability is not advertised with `readOnlyHint: true`. */
  mutation: boolean
  /** True when the capability advertises `destructiveHint: true`. */
  destructive: boolean
  outcome: AuditOutcome
  durationMs: number
  argumentsDigest: string
  systemId?: string
  target?: AuditTarget
  uri?: string
  errorCode?: string
  sessionId?: string
  requestId?: string
  arguments?: Record<string, unknown>
}

export interface AuditRecordInput {
  kind: AuditCapabilityKind
  name: string
  mutation: boolean
  destructive: boolean
  outcome: AuditOutcome
  durationMs: number
  arguments?: unknown
  uri?: string
  errorCode?: string
  sessionId?: string
  requestId?: string
  principal?: AuditPrincipal
}

export interface AuditSink {
  readonly name: AuditSinkName
  write(event: AuditEvent): void
  close(): Promise<void>
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  return SENSITIVE_KEY_PARTS.some(part => normalized.includes(part))
}

function truncateUtf8(value: string, byteLimit: number): string {
  const bytes = Buffer.byteLength(value, "utf8")
  if (bytes <= byteLimit) return value
  let kept = ""
  let used = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8")
    if (used + size > byteLimit) break
    kept += character
    used += size
  }
  return `${kept}[truncated:${bytes}B]`
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null) return null
  if (typeof value === "string") {
    return truncateUtf8(value, AUDIT_ARGUMENT_STRING_BYTE_LIMIT)
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (depth >= AUDIT_ARGUMENT_DEPTH_LIMIT) return "[depth-limit]"
  if (Array.isArray(value)) {
    const kept = value
      .slice(0, AUDIT_ARGUMENT_ARRAY_LIMIT)
      .map(entry => redactValue(entry, depth + 1))
    return value.length > AUDIT_ARGUMENT_ARRAY_LIMIT
      ? [...kept, `[omitted:${value.length - AUDIT_ARGUMENT_ARRAY_LIMIT}]`]
      : kept
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1)
    }
    return output
  }
  return undefined
}

/**
 * Redact and bound tool arguments so an audit record can never carry a secret,
 * a complete ABAP source body, or an unbounded payload.
 */
export function redactAuditArguments(
  value: unknown
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const redacted = redactValue(value, 0) as Record<string, unknown>
  const bytes = Buffer.byteLength(JSON.stringify(redacted), "utf8")
  if (bytes > AUDIT_ARGUMENT_TOTAL_BYTE_LIMIT) {
    return { omitted: true, bytes }
  }
  return redacted
}

export function auditArgumentsDigest(redacted: unknown): string {
  const canonical = redacted === undefined ? "" : JSON.stringify(redacted)
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32)
}

function firstString(
  source: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return truncateUtf8(value.trim(), 256)
    }
  }
  return undefined
}

export function extractAuditSystemId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined
  return firstString(value as Record<string, unknown>, SYSTEM_ID_KEYS)
}

/**
 * Extract only scalar object identity from tool arguments. Never returns source
 * content, SQL text, or credentials.
 */
export function extractAuditTarget(value: unknown): AuditTarget | undefined {
  if (value === null || typeof value !== "object") return undefined
  const source = value as Record<string, unknown>
  const target: AuditTarget = {}
  for (const [field, keys] of Object.entries(TARGET_KEY_GROUPS)) {
    const resolved = firstString(source, keys)
    if (resolved !== undefined) {
      target[field as keyof AuditTarget] = resolved
    }
  }
  return Object.keys(target).length > 0 ? target : undefined
}

export function classifyAuditOutcome(errorCode?: string): AuditOutcome {
  if (errorCode === undefined) return "succeeded"
  return AUDIT_POLICY_DENIAL_CODES.has(errorCode) ? "denied" : "failed"
}

export function localProcessPrincipal(): AuditPrincipal {
  let id = "unknown"
  try {
    const name = userInfo().username
    if (typeof name === "string" && name.length > 0) id = name
  } catch {
    id = "unknown"
  }
  return { id, source: "local-process" }
}

export const NULL_AUDIT_SINK: AuditSink = {
  name: "none",
  write: () => undefined,
  close: async () => undefined
}

function serializeEvent(event: AuditEvent): string {
  return `${JSON.stringify(event)}\n`
}

export function createStderrAuditSink(): AuditSink {
  return {
    name: "stderr",
    write: event => {
      try {
        stderr.write(serializeEvent(event))
      } catch {
        // A failed audit write must never break the MCP session.
      }
    },
    close: async () => undefined
  }
}

export function createFileAuditSink(path: string): AuditSink {
  const absolutePath = isAbsolute(path) ? path : resolve(path)
  let stream: WriteStream
  try {
    mkdirSync(dirname(absolutePath), { recursive: true })
    stream = createWriteStream(absolutePath, { flags: "a", mode: 0o600 })
  } catch (error) {
    throw new AppError(
      "AUDIT_LOG_UNWRITABLE",
      `The audit log file could not be opened: ${absolutePath}`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
  let degraded = false
  const degrade = (reason: string) => {
    if (degraded) return
    degraded = true
    stderr.write(
      `${JSON.stringify({
        schema: AUDIT_SCHEMA_VERSION,
        event: "audit-sink-degraded",
        sink: "file",
        path: absolutePath,
        reason
      })}\n`
    )
  }
  stream.on("error", error => degrade(error.message))
  return {
    name: "file",
    write: event => {
      if (degraded) return
      try {
        stream.write(serializeEvent(event))
      } catch (error) {
        degrade(error instanceof Error ? error.message : String(error))
      }
    },
    close: async () => {
      await new Promise<void>(resolveClose => {
        stream.end(() => resolveClose())
      })
    }
  }
}

export interface AuditRecorderOptions {
  sink: AuditSink
  apiVersion: string
  principal?: AuditPrincipal
  includeArguments?: boolean
  now?: () => Date
  newEventId?: () => string
  /**
   * Set to false for a derived recorder that shares another recorder's sink.
   * Only the owning recorder closes the sink.
   */
  ownsSink?: boolean
}

export class AuditRecorder {
  private readonly sink: AuditSink
  private readonly apiVersion: string
  private readonly principal: AuditPrincipal
  private readonly includeArguments: boolean
  private readonly now: () => Date
  private readonly newEventId: () => string
  private readonly ownsSink: boolean

  constructor(options: AuditRecorderOptions) {
    this.sink = options.sink
    this.apiVersion = options.apiVersion
    this.principal = options.principal ?? localProcessPrincipal()
    this.includeArguments = options.includeArguments ?? false
    this.now = options.now ?? (() => new Date())
    this.newEventId = options.newEventId ?? randomUUID
    this.ownsSink = options.ownsSink ?? true
  }

  /**
   * Derive a recorder for one authenticated session. The derived recorder writes
   * to the same sink but stamps every event with the session's principal, and it
   * never closes the shared sink.
   */
  withPrincipal(principal: AuditPrincipal): AuditRecorder {
    return new AuditRecorder({
      sink: this.sink,
      apiVersion: this.apiVersion,
      principal,
      includeArguments: this.includeArguments,
      now: this.now,
      newEventId: this.newEventId,
      ownsSink: false
    })
  }

  get enabled(): boolean {
    return this.sink.name !== "none"
  }

  build(input: AuditRecordInput): AuditEvent {
    const redacted = redactAuditArguments(input.arguments)
    const systemId = extractAuditSystemId(input.arguments)
    const target = extractAuditTarget(input.arguments)
    return {
      schema: AUDIT_SCHEMA_VERSION,
      eventId: this.newEventId(),
      timestamp: this.now().toISOString(),
      principal: input.principal ?? this.principal,
      apiVersion: this.apiVersion,
      kind: input.kind,
      name: input.name,
      mutation: input.mutation,
      destructive: input.destructive,
      outcome: input.outcome,
      durationMs: input.durationMs,
      argumentsDigest: auditArgumentsDigest(redacted),
      ...(systemId !== undefined ? { systemId } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(input.uri !== undefined
        ? { uri: truncateUtf8(input.uri, 1024) }
        : {}),
      ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      ...(this.includeArguments && redacted !== undefined
        ? { arguments: redacted }
        : {})
    }
  }

  record(input: AuditRecordInput): AuditEvent | undefined {
    if (!this.enabled) return undefined
    const event = this.build(input)
    this.sink.write(event)
    return event
  }

  async close(): Promise<void> {
    if (this.ownsSink) await this.sink.close()
  }
}

export interface AuditConfiguration {
  sink: AuditSinkName
  file?: string
  includeArguments: boolean
}

export function parseAuditSinkName(value: string | undefined): AuditSinkName {
  if (value === undefined || value.trim().length === 0) return "none"
  const normalized = value.trim().toLowerCase()
  if ((AUDIT_SINK_NAMES as readonly string[]).includes(normalized)) {
    return normalized as AuditSinkName
  }
  throw new AppError(
    "INVALID_AUDIT_SINK",
    `Unknown audit log sink: ${value}`,
    { available: [...AUDIT_SINK_NAMES] }
  )
}

export function createAuditSink(configuration: AuditConfiguration): AuditSink {
  if (configuration.sink === "none") return NULL_AUDIT_SINK
  if (configuration.sink === "stderr") return createStderrAuditSink()
  if (!configuration.file || configuration.file.trim().length === 0) {
    throw new AppError(
      "AUDIT_LOG_FILE_REQUIRED",
      "--audit-log file requires --audit-log-file <path>"
    )
  }
  return createFileAuditSink(configuration.file.trim())
}
