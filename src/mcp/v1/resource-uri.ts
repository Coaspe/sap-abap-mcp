import { AppError } from "../../errors.js"

const SYSTEM_ID_PATTERN = /^[A-Z0-9_-]+$/
const ADT_PATH_PREFIX = "/sap/bc/adt/"
const MALFORMED_PERCENT_PATTERN = /%(?![0-9A-Fa-f]{2})/
const RAW_C0_CONTROL_PATTERN = /[\u0000-\u001F]/
const OPAQUE_SEGMENT_PATTERN = /^[a-z0-9_-]+$/
const TRANSPORT_PATTERN = /^[A-Z0-9_-]+$/

export interface ParsedAdtResourceUri {
  systemId: string
  adtPath: string
  canonicalUri: string
}

function invalidUri(message: string): never {
  throw new AppError("INVALID_ADT_URI", message)
}

export function assertRawV1ResourceUri(value: string): void {
  if (MALFORMED_PERCENT_PATTERN.test(value)) {
    invalidUri("URI contains a malformed percent escape")
  }
  if (RAW_C0_CONTROL_PATTERN.test(value)) {
    invalidUri("URI contains a disallowed preprocessing character")
  }
}

function parseUrl(value: string): URL {
  assertRawV1ResourceUri(value)
  assertNoRawAuthoritySyntax(value)

  try {
    return new URL(value.replaceAll(" ", "%20"))
  } catch {
    return invalidUri("URI is malformed")
  }
}

function assertNoRawAuthoritySyntax(value: string): void {
  const schemeEnd = value.indexOf("://")
  if (schemeEnd === -1) return

  const authorityStart = schemeEnd + 3
  const pathStart = value.indexOf("/", authorityStart)
  const authority = value.slice(
    authorityStart,
    pathStart === -1 ? value.length : pathStart
  )
  if (authority.includes("@") || authority.includes(":")) {
    invalidUri("URI userinfo and port syntax are not allowed")
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

function singlePathSegment(url: URL, label: string): string {
  const raw = url.pathname.replace(/^\//, "")
  if (!raw || raw.includes("/")) return invalidUri(`${label} must be one path segment`)
  try {
    return decodeURIComponent(raw)
  } catch {
    return invalidUri(`${label} contains a malformed percent escape`)
  }
}

export function parseTransportResourceUri(value: string): {
  systemId: string
  transport: string
  canonicalUri: string
} {
  assertNoQueryOrFragment(value)
  const url = parseUrl(value)
  if (url.protocol !== "sap-transport:") {
    return invalidUri("URI must use the sap-transport scheme")
  }
  assertNoExtraAuthorityParts(url)
  const systemId = normalizeV1SystemId(url.hostname)
  const transport = singlePathSegment(url, "Transport").toUpperCase()
  if (!TRANSPORT_PATTERN.test(transport)) {
    return invalidUri("Transport contains unsupported characters")
  }
  return {
    systemId,
    transport,
    canonicalUri: `sap-transport://${systemId.toLowerCase()}/${transport}`
  }
}

export function parseEvidenceResourceUri(value: string): {
  runId: string
  artifact: string
  canonicalUri: string
} {
  assertNoQueryOrFragment(value)
  const url = parseUrl(value)
  if (url.protocol !== "sap-evidence:") {
    return invalidUri("URI must use the sap-evidence scheme")
  }
  assertNoExtraAuthorityParts(url)
  const runId = url.hostname.toLowerCase()
  const artifact = singlePathSegment(url, "Evidence artifact").toLowerCase()
  if (!OPAQUE_SEGMENT_PATTERN.test(runId) || !OPAQUE_SEGMENT_PATTERN.test(artifact)) {
    return invalidUri("Evidence identifiers contain unsupported characters")
  }
  return {
    runId,
    artifact,
    canonicalUri: `sap-evidence://${runId}/${artifact}`
  }
}

export function parseDocsResourceUri(value: string): {
  family: "data-query" | "compat" | "mermaid"
  document?: string
  canonicalUri: string
} {
  assertNoQueryOrFragment(value)
  const url = parseUrl(value)
  if (url.protocol !== "sap-docs:") {
    return invalidUri("URI must use the sap-docs scheme")
  }
  assertNoExtraAuthorityParts(url)
  const family = url.hostname.toLowerCase()
  if (family === "data-query") {
    if (url.pathname !== "") return invalidUri("Data-query documentation has no path")
    return { family, canonicalUri: "sap-docs://data-query" }
  }
  if (family !== "compat" && family !== "mermaid") {
    return invalidUri("Unknown documentation family")
  }
  const document = singlePathSegment(url, "Documentation name").toLowerCase()
  if (!OPAQUE_SEGMENT_PATTERN.test(document)) {
    return invalidUri("Documentation name contains unsupported characters")
  }
  return {
    family,
    document,
    canonicalUri: `sap-docs://${family}/${document}`
  }
}
