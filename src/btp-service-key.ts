import { readFileSync } from "node:fs"
import { AppError } from "./errors.js"

/** SAP BTP ABAP environment always exposes SAP client 100. */
export const BTP_ABAP_CLIENT = "100"
const OAUTH_TOKEN_PATH = "/oauth/token"

export interface BtpServiceKeyCredentials {
  /** ABAP system base URL, used as the profile `url`. */
  url: string
  /** Full OAuth token endpoint. */
  tokenUrl: string
  clientId: string
  clientSecret: string
  client: string
  systemId?: string
}

function requiredString(
  container: Record<string, unknown> | undefined,
  key: string,
  path: string
): string {
  const value = container?.[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(
      "SERVICE_KEY_INVALID",
      `The service key is missing a non-empty "${path}" value`
    )
  }
  return value.trim()
}

function httpsUrl(value: string, path: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AppError(
      "SERVICE_KEY_INVALID",
      `The service key "${path}" value is not a valid URL`
    )
  }
  if (parsed.protocol !== "https:") {
    throw new AppError(
      "SERVICE_KEY_INVALID",
      `The service key "${path}" value must use HTTPS`
    )
  }
  if (parsed.username || parsed.password) {
    throw new AppError(
      "SERVICE_KEY_INVALID",
      `The service key "${path}" value must not embed credentials`
    )
  }
  return value.replace(/\/+$/, "")
}

/**
 * Derive OAuth client-credentials settings from an SAP BTP ABAP environment
 * service key document.
 *
 * The token endpoint is taken from an explicit `tokenurl` when the key provides
 * one, and otherwise composed from the UAA base URL, which is how BTP documents
 * the client-credentials flow.
 *
 * Certificate-only bindings, which expose `certurl` and `certificate` instead of
 * `clientsecret`, are rejected: this server does not implement mTLS client
 * authentication, and silently falling back would produce a profile that can
 * never authenticate.
 */
export function parseBtpServiceKey(text: string): BtpServiceKeyCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new AppError(
      "SERVICE_KEY_INVALID",
      "The service key is not valid JSON",
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("SERVICE_KEY_INVALID", "The service key must be a JSON object")
  }
  const document = parsed as Record<string, unknown>
  const uaaValue = document.uaa
  const uaa = uaaValue !== null && typeof uaaValue === "object" && !Array.isArray(uaaValue)
    ? uaaValue as Record<string, unknown>
    : undefined
  if (!uaa) {
    throw new AppError(
      "SERVICE_KEY_INVALID",
      "The service key is missing its \"uaa\" object. Use a service key created for the ABAP environment service."
    )
  }
  if (
    typeof uaa.clientsecret !== "string" &&
    (typeof uaa.certificate === "string" || typeof uaa.certurl === "string")
  ) {
    throw new AppError(
      "SERVICE_KEY_CERTIFICATE_UNSUPPORTED",
      "This service key uses X.509 client certificate authentication, which this release does not support. Create a service key with a client secret instead."
    )
  }

  const url = httpsUrl(requiredString(document, "url", "url"), "url")
  const clientId = requiredString(uaa, "clientid", "uaa.clientid")
  const clientSecret = requiredString(uaa, "clientsecret", "uaa.clientsecret")
  const explicitTokenUrl = typeof uaa.tokenurl === "string" && uaa.tokenurl.trim()
    ? uaa.tokenurl.trim()
    : typeof document.tokenurl === "string" && document.tokenurl.trim()
      ? document.tokenurl.trim()
      : undefined
  const tokenUrl = explicitTokenUrl
    ? httpsUrl(explicitTokenUrl, "uaa.tokenurl")
    : `${httpsUrl(requiredString(uaa, "url", "uaa.url"), "uaa.url")}${OAUTH_TOKEN_PATH}`
  const systemId = typeof document.systemid === "string" && document.systemid.trim()
    ? document.systemid.trim()
    : undefined

  return {
    url,
    tokenUrl,
    clientId,
    clientSecret,
    client: BTP_ABAP_CLIENT,
    ...(systemId !== undefined ? { systemId } : {})
  }
}

export function loadBtpServiceKey(path: string): BtpServiceKeyCredentials {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    throw new AppError(
      "SERVICE_KEY_UNREADABLE",
      `The service key file could not be read: ${path}`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
  return parseBtpServiceKey(text)
}
