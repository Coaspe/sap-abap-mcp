import { AppError } from "./errors.js"

export interface AbapGitCredentials {
  repositoryUrl: string
  username: string
  password: string
}

export function normalizeAbapGitRepositoryUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new AppError("ABAPGIT_URL_INVALID", `Invalid repository URL: ${value}`)
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new AppError("ABAPGIT_URL_INVALID", "abapGit repository URL must use HTTP or HTTPS")
  }
  if (url.username || url.password) {
    throw new AppError(
      "ABAPGIT_URL_INVALID",
      "Do not embed credentials in repositoryUrl; use abapgit auth login"
    )
  }
  return url.toString()
}

export function abapGitCredentialKey(connectionId: string): string {
  return `${connectionId.trim().toUpperCase()}_ABAPGIT`
}

export function encodeAbapGitCredentials(credentials: AbapGitCredentials[]): string {
  return JSON.stringify(credentials)
}

export function decodeAbapGitCredentials(value: string): AbapGitCredentials[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new AppError("ABAPGIT_CREDENTIAL_INVALID", "Stored abapGit credentials are invalid")
  }
  if (!Array.isArray(parsed) || parsed.some(item =>
    !item ||
    typeof item !== "object" ||
    typeof (item as Record<string, unknown>).repositoryUrl !== "string" ||
    typeof (item as Record<string, unknown>).username !== "string" ||
    typeof (item as Record<string, unknown>).password !== "string"
  )) {
    throw new AppError("ABAPGIT_CREDENTIAL_INVALID", "Stored abapGit credentials are invalid")
  }
  return parsed as AbapGitCredentials[]
}
