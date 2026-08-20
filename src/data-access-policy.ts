import { AppError } from "./errors.js"

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
