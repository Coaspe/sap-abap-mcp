import { AppError } from "./errors.js"

const DENIED_TABLES = new Set([
  // SAP users, roles, authentication, and secure destinations.
  "AGR_1251", "AGR_USERS", "RFCDES", "SECSTORE", "SSF_PSE_D",
  "USH02", "USR02", "USR04", "USR10", "USR12", "USR21", "USR22", "USRBF2",
  // Bank and payment data.
  "BNKA", "BUT0BK", "FPAYH", "FPAYP", "KNBK", "LFBK", "PAYR", "REGUH", "REGUP", "T012K",
  // Business-partner identity and address data.
  "ADR2", "ADR3", "ADR6", "ADRC", "ADRP", "BUT000", "BUT0ID", "KNA1", "LFA1",
  // Tax identifiers and strict audit/workflow payloads.
  "BALDAT", "DFKKBPTAXNUM", "SNAP"
])

const CONFIRMATION_TABLES = new Set([
  "ACDOCA", "BKPF", "BSEG", "CDHDR", "CDPOS", "EKKO", "EKPO",
  "STXH", "STXL", "VBAK", "VBAP", "VBPA", "VBRK", "VBRP"
])

const TABLE_SOURCE = /\b(?:FROM|JOIN)\s+("[^"]+"|[^\s,]+)/giu

function normalizeTableName(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/[;,]$/g, "").toUpperCase()
}

function isDeniedTable(table: string): boolean {
  return DENIED_TABLES.has(table) ||
    /^(?:PA|PB|HRP)\d{4}$/.test(table) ||
    /^PCL[1-4]$/.test(table)
}

export function extractSqlDataSources(sql: string): string[] {
  const sources: string[] = []
  for (const match of sql.matchAll(TABLE_SOURCE)) {
    const raw = match[1] ?? ""
    if (raw.startsWith("(") || raw.startsWith("@")) {
      throw new AppError(
        "DATA_QUERY_SOURCE_UNRESOLVED",
        "The data-query policy cannot inspect a dynamic table source"
      )
    }
    const table = normalizeTableName(raw)
    if (table && !sources.includes(table)) sources.push(table)
  }
  if (sources.length === 0) {
    throw new AppError(
      "DATA_QUERY_SOURCE_UNRESOLVED",
      "The data-query policy could not identify a table source"
    )
  }
  return sources
}

export function enforceDataAccessPolicy(
  sql: string,
  acknowledgeRisk = false
): { tables: string[]; confirmationRequired: boolean } {
  const tables = extractSqlDataSources(sql)
  if (tables.some(isDeniedTable)) {
    throw new AppError(
      "DATA_QUERY_TABLE_DENIED",
      "The query targets a table category that this MCP does not expose"
    )
  }
  const confirmationRequired = tables.some(table => CONFIRMATION_TABLES.has(table))
  if (confirmationRequired && !acknowledgeRisk) {
    throw new AppError(
      "DATA_QUERY_CONFIRMATION_REQUIRED",
      "This business-data query requires acknowledgeRisk=true"
    )
  }
  return { tables, confirmationRequired }
}

export function requireDataQueryOptIn(profile: { allowDataQueries?: boolean }): void {
  if (profile.allowDataQueries !== true) {
    throw new AppError(
      "DATA_QUERY_NOT_ALLOWED",
      "SAP data queries are disabled for this profile; recreate it with --allow-data-queries"
    )
  }
}
