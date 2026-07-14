import { AppError } from "./errors.js"

const REPL_PATH = "/sap/bc/z_abap_repl"

export interface ReplHttpClient {
  request(
    path: string,
    options: {
      method: "GET" | "POST"
      headers?: Record<string, string>
      body?: string
      timeout: number
    }
  ): Promise<{ status: number; body: string }>
}

export interface ReplResponse {
  success: boolean
  output: string
  error: string
  runtime_ms: number
}

export interface ReplHealthCheck {
  status: string
  version: string
  user: string
  system: string
  client: string
  production: boolean
}

type FieldType = "string" | "boolean" | "number"
type FieldValue<T extends FieldType> = T extends "string"
  ? string
  : T extends "boolean"
    ? boolean
    : number

function sanitizeJsonBody(body: string): string {
  let result = ""
  let inString = false
  let escaped = false

  for (const character of body) {
    if (!inString) {
      result += character
      if (character === '"') inString = true
      continue
    }

    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x20) {
      const escapePrefix = escaped ? "" : "\\"
      if (character === "\n") result += `${escapePrefix}n`
      else if (character === "\r") result += `${escapePrefix}r`
      else if (character === "\t") result += `${escapePrefix}t`
      else result += `${escapePrefix}u${codePoint.toString(16).padStart(4, "0")}`
      escaped = false
      continue
    }

    if (escaped) {
      result += character
      escaped = false
      continue
    }

    if (character === "\\") {
      result += character
      escaped = true
      continue
    }

    if (character === '"') {
      result += character
      inString = false
      continue
    }

    result += character
  }

  return result
}

function parseRecord(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(sanitizeJsonBody(body))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("top-level JSON value is not an object")
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new AppError(
      "SAP_OPERATION_FAILED",
      "ABAP REPL returned malformed JSON",
      {
        endpoint: REPL_PATH,
        cause: error instanceof Error ? error.message : String(error)
      }
    )
  }
}

function requireHttpSuccess(status: number): void {
  if (status >= 200 && status < 300) return
  throw Object.assign(new Error(`ABAP REPL returned HTTP ${status}`), { status })
}

function requireFields<T extends Record<string, FieldType>>(
  record: Record<string, unknown>,
  fields: T
): { [K in keyof T]: FieldValue<T[K]> } {
  for (const key of Object.keys(fields) as Array<keyof T>) {
    const type = fields[key]
    if (typeof record[key as string] !== type) {
      throw new AppError(
        "SAP_OPERATION_FAILED",
        `ABAP REPL field ${String(key)} must be ${type}`,
        { endpoint: REPL_PATH }
      )
    }
  }
  return record as { [K in keyof T]: FieldValue<T[K]> }
}

export async function checkReplAvailability(
  http: ReplHttpClient
): Promise<ReplHealthCheck> {
  const response = await http.request(REPL_PATH, {
    method: "GET",
    timeout: 10_000
  })
  requireHttpSuccess(response.status)
  return requireFields(parseRecord(response.body), {
    status: "string",
    version: "string",
    user: "string",
    system: "string",
    client: "string",
    production: "boolean"
  })
}

export async function executeAbapCode(
  http: ReplHttpClient,
  code: string
): Promise<ReplResponse> {
  const response = await http.request(REPL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    timeout: 60_000
  })
  requireHttpSuccess(response.status)
  return requireFields(parseRecord(response.body), {
    success: "boolean",
    output: "string",
    error: "string",
    runtime_ms: "number"
  })
}
