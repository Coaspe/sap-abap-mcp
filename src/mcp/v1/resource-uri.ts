import { AppError } from "../../errors.js"

const SYSTEM_ID_PATTERN = /^[A-Z0-9_-]+$/
const ADT_PATH_PREFIX = "/sap/bc/adt/"
const MALFORMED_PERCENT_PATTERN = /%(?![0-9A-Fa-f]{2})/

export interface ParsedAdtResourceUri {
  systemId: string
  adtPath: string
  canonicalUri: string
}

function invalidUri(message: string): never {
  throw new AppError("INVALID_ADT_URI", message)
}

function parseUrl(value: string): URL {
  if (MALFORMED_PERCENT_PATTERN.test(value)) {
    return invalidUri("URI contains a malformed percent escape")
  }

  try {
    return new URL(value)
  } catch {
    return invalidUri("URI is malformed")
  }
}

function assertNoExtraAuthorityParts(url: URL): void {
  if (url.username || url.password || url.port) {
    invalidUri("URI credentials and ports are not allowed")
  }
}

function assertNoQueryOrFragment(value: string): void {
  if (value.includes("?") || value.includes("#")) {
    invalidUri("URI queries and fragments are not allowed")
  }
}

export function normalizeV1SystemId(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!SYSTEM_ID_PATTERN.test(normalized)) {
    return invalidUri(`Invalid SAP profile ID: ${value}`)
  }
  return normalized
}

export function toAdtResourceUri(systemId: string, adtPath: string): string {
  const normalizedSystemId = normalizeV1SystemId(systemId)
  if (!adtPath.startsWith(ADT_PATH_PREFIX)) {
    return invalidUri(`ADT path must begin with ${ADT_PATH_PREFIX}`)
  }
  return parseAdtResourceUri(
    `adt://${normalizedSystemId.toLowerCase()}${adtPath}`
  ).canonicalUri
}

export function parseAdtResourceUri(value: string): ParsedAdtResourceUri {
  assertNoQueryOrFragment(value)
  const url = parseUrl(value)

  if (url.protocol !== "adt:") {
    return invalidUri("URI must use the adt scheme")
  }
  assertNoExtraAuthorityParts(url)

  const systemId = normalizeV1SystemId(url.hostname)
  if (!url.pathname.startsWith(ADT_PATH_PREFIX)) {
    return invalidUri(`ADT path must begin with ${ADT_PATH_PREFIX}`)
  }

  return {
    systemId,
    adtPath: url.pathname,
    canonicalUri: `adt://${systemId.toLowerCase()}${url.pathname}`
  }
}

export function toCapabilityResourceUri(systemId: string): string {
  return `sap-capability://${normalizeV1SystemId(systemId).toLowerCase()}`
}

export function parseCapabilityResourceUri(value: string): {
  systemId: string
  canonicalUri: string
} {
  assertNoQueryOrFragment(value)
  const url = parseUrl(value)

  if (url.protocol !== "sap-capability:") {
    return invalidUri("URI must use the sap-capability scheme")
  }
  assertNoExtraAuthorityParts(url)
  if (url.pathname !== "") {
    return invalidUri("Capability URI must not contain a path")
  }

  const systemId = normalizeV1SystemId(url.hostname)
  return {
    systemId,
    canonicalUri: `sap-capability://${systemId.toLowerCase()}`
  }
}
