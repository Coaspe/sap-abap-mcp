import { AppError } from "./errors.js"

export const DEFAULT_BLOCKED_DATA_SOURCES = ["USR*", "PA0*", "HRP1000"]

// Inspect every identifier, not only the first FROM: this also covers joins,
// subqueries and schema-qualified names. String literals are not identifiers.
export function requireAllowedDataSources(profile: { blockedDataSources?: string[] | undefined }, sql: string): void {
  const patterns = profile.blockedDataSources ?? DEFAULT_BLOCKED_DATA_SOURCES
  const identifiers = sql.replace(/'(?:''|[^'])*'/g, " ").match(/(?:\/[A-Za-z0-9_]+\/)?[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  for (const identifier of identifiers) {
    const name = identifier.toUpperCase()
    if (patterns.some(pattern => {
      const normalized = pattern.toUpperCase()
      return normalized.endsWith("*") ? name.startsWith(normalized.slice(0, -1)) : name === normalized
    })) {
      throw new AppError("DATA_SOURCE_BLOCKED", `Data source policy blocks identifier ${name}`, {
        recovery: "Review the profile's blockedDataSources policy with its owner before querying."
      })
    }
  }
}

export function requireDataQueryOptIn(profile: {
  environment?: "development" | "quality" | "production"
  allowDataQueries?: boolean
}): void {
  if (profile.environment === "production" || profile.allowDataQueries !== true) {
    throw new AppError(
      "DATA_QUERY_NOT_ALLOWED",
      profile.environment === "production"
        ? "SAP data queries are disabled for production profiles"
        : "SAP data queries are disabled for this profile; enable them with setup edit or recreate the profile with --allow-data-queries"
    )
  }
}
