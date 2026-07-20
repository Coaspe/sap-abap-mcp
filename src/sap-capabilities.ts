import { AppError } from "./errors.js"

export type SapCapabilityCategory =
  | "connection"
  | "repository"
  | "execution"
  | "semantic"
  | "quality"
  | "debugging"
  | "insight"

export type SapCapabilityStatus = "supported" | "unsupported" | "unverified"

export interface SapCapabilityRecord {
  id: string
  category: SapCapabilityCategory
  implementation: "implemented" | "missing"
  system: "advertised" | "not_advertised" | "unknown"
  authorization: "allowed" | "denied" | "unknown"
  status: SapCapabilityStatus
  evidence: string[]
  lastObservedAt: string | null
}

// Bound each process-memory evidence entry to 512 UTF-8 bytes.
const MAX_EVIDENCE_BYTES = 512
const EVIDENCE_TRUNCATION_MARKER = "[TRUNCATED]"

interface SapCapabilityDefinition {
  id: string
  category: SapCapabilityCategory
  implementation: SapCapabilityRecord["implementation"]
  discoveryNeedle?: string
}

interface SapCapabilityObservation {
  system?: Exclude<SapCapabilityRecord["system"], "unknown">
  authorization?: Exclude<SapCapabilityRecord["authorization"], "unknown">
  evidence: string[]
  lastObservedAt?: string
  succeeded: boolean
}

function normalizeId(value: string): string {
  return value.trim().toUpperCase()
}

const CAPABILITY_DEFINITIONS: SapCapabilityDefinition[] = [
  {
    id: "repository.create.bdef",
    category: "repository",
    implementation: "implemented",
    discoveryNeedle: "bo/behaviordefinitions"
  },
  {
    id: "repository.activate.batch",
    category: "repository",
    implementation: "implemented",
    discoveryNeedle: "/sap/bc/adt/activation"
  },
  {
    id: "execution.class_runner",
    category: "execution",
    implementation: "implemented",
    discoveryNeedle: "/sap/bc/adt/oo/classrun"
  },
  {
    id: "execution.abap_repl",
    category: "execution",
    implementation: "implemented"
  },
  {
    id: "semantic.completion_element",
    category: "semantic",
    implementation: "implemented",
    discoveryNeedle: "codecompletion/elementinfo"
  },
  {
    id: "semantic.documentation",
    category: "semantic",
    implementation: "implemented",
    discoveryNeedle: "docu/abap/langu"
  },
  {
    id: "semantic.type_hierarchy",
    category: "semantic",
    implementation: "implemented",
    discoveryNeedle: "abapsource/typehierarchy"
  },
  {
    id: "semantic.components",
    category: "semantic",
    implementation: "implemented",
    discoveryNeedle: "objectstructure"
  },
  { id: "connection.auth.bearer", category: "connection", implementation: "missing" },
  { id: "connection.auth.certificate", category: "connection", implementation: "missing" },
  { id: "connection.auth.kerberos", category: "connection", implementation: "missing" },
  { id: "connection.auth.browser_sso", category: "connection", implementation: "missing" },
  { id: "connection.auth.oauth", category: "connection", implementation: "implemented" },
  { id: "connection.auth.btp_cloud", category: "connection", implementation: "missing" },
  { id: "quality.abap_cleaner", category: "quality", implementation: "missing" },
  { id: "quality.atc_exemptions", category: "quality", implementation: "missing" },
  { id: "quality.package_tests", category: "quality", implementation: "missing" },
  { id: "quality.coverage", category: "quality", implementation: "missing" },
  {
    id: "debugging.trace_configuration",
    category: "debugging",
    implementation: "missing"
  },
  { id: "debugging.watchpoints", category: "debugging", implementation: "missing" },
  {
    id: "debugging.message_breakpoints",
    category: "debugging",
    implementation: "missing"
  },
  {
    id: "debugging.exception_breakpoints",
    category: "debugging",
    implementation: "missing"
  },
  { id: "debugging.record_replay", category: "debugging", implementation: "missing" },
  { id: "insight.blame", category: "insight", implementation: "missing" },
  { id: "insight.s4hana_readiness", category: "insight", implementation: "missing" },
  {
    id: "insight.adt_communication_logs",
    category: "insight",
    implementation: "missing"
  },
  { id: "insight.feeds", category: "insight", implementation: "missing" }
]

const DEFINITIONS_BY_ID = new Map(
  CAPABILITY_DEFINITIONS.map(definition => [normalizeId(definition.id), definition])
)

function capabilityDefinition(capabilityId: string): SapCapabilityDefinition {
  const definition = DEFINITIONS_BY_ID.get(normalizeId(capabilityId))
  if (!definition) {
    throw new AppError(
      "SAP_CAPABILITY_UNAVAILABLE",
      `Unknown SAP capability: ${capabilityId}`,
      { capabilityId }
    )
  }
  return definition
}

function numericHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined

  if ("response" in error && typeof error.response === "object" && error.response !== null &&
    "status" in error.response && typeof error.response.status === "number") {
    return error.response.status
  }
  if ("status" in error && typeof error.status === "number") return error.status
  return undefined
}

function sanitizeSensitiveHeaders(value: string): string {
  return value.replace(
    /(^|[^a-z0-9-])(x-csrf-token|set-cookie|authorization|cookie)(\s*:\s*)[^\r\n]*/gi,
    (_match, prefix, header, delimiter) =>
      `${prefix}${header}${delimiter}[REDACTED]`
  )
}

function sanitizeSensitiveText(value: string): string {
  const sanitized = value.replace(
    /(^|[^a-z0-9_-])(["']?)(x-csrf-token|set-cookie|access_token|refresh_token|csrf[-_]token|session_id|password|authorization|token|cookie|csrf|session)\2(\s*[:=]\s*)(?:(["'])([\s\S]*?)\5|((?:Bearer\s+)?[^\s,;&#}\]]+))/gi,
    (_match, prefix, labelQuote, label, delimiter, valueQuote) =>
      `${prefix}${labelQuote}${label}${labelQuote}${delimiter}` +
      (valueQuote ? `${valueQuote}[REDACTED]${valueQuote}` : "[REDACTED]")
  )
  return sanitizeSensitiveHeaders(sanitized)
}

function truncateEvidence(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_EVIDENCE_BYTES) return value

  const markerBytes = Buffer.byteLength(EVIDENCE_TRUNCATION_MARKER, "utf8")
  let bytes = 0
  let truncated = ""
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8")
    if (bytes + characterBytes + markerBytes > MAX_EVIDENCE_BYTES) break
    truncated += character
    bytes += characterBytes
  }
  return truncated + EVIDENCE_TRUNCATION_MARKER
}

function sanitizedErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null &&
        "message" in error && typeof error.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : "SAP operation failed"

  return sanitizeSensitiveText(message)
}

export function normalizeCapabilityError(
  error: unknown,
  capabilityId: string,
  endpoint: string,
  validationFailure = false
): AppError {
  const httpStatus = numericHttpStatus(error)
  const code = httpStatus === 401 || httpStatus === 403
    ? "SAP_AUTHORIZATION_DENIED"
    : httpStatus === 404 || httpStatus === 405
      ? "SAP_CAPABILITY_UNAVAILABLE"
      : validationFailure
        ? "SAP_VALIDATION_FAILED"
        : "SAP_OPERATION_FAILED"

  return new AppError(
    code,
    `SAP capability ${capabilityId} failed: ${sanitizedErrorMessage(error)}`,
    {
      capabilityId,
      endpoint: sanitizeSensitiveText(endpoint),
      ...(httpStatus === undefined ? {} : { httpStatus })
    }
  )
}

export class SapCapabilityRegistry {
  private readonly observations = new Map<string, Map<string, SapCapabilityObservation>>()

  observeAdvertised(connectionId: string, capabilityId: string, evidence: string): void {
    this.update(connectionId, capabilityId, observation => {
      observation.system = "advertised"
      this.addEvidence(observation, `discovery:${evidence}`)
    })
  }

  observeSuccess(connectionId: string, capabilityId: string, evidence: string): void {
    this.update(connectionId, capabilityId, observation => {
      if (observation.system === "not_advertised") delete observation.system
      observation.succeeded = true
      observation.authorization = "allowed"
      this.addEvidence(observation, `success:${evidence}`)
    })
  }

  observeHttpFailure(
    connectionId: string,
    capabilityId: string,
    status: number,
    endpoint: string
  ): void {
    this.update(connectionId, capabilityId, observation => {
      if (status === 401 || status === 403) observation.authorization = "denied"
      if (status === 404 || status === 405) observation.system = "not_advertised"
      this.addEvidence(observation, `http:${status}:${endpoint}`)
    })
  }

  observeFailure(
    connectionId: string,
    capabilityId: string,
    error: unknown,
    endpoint: string
  ): void {
    const status = numericHttpStatus(error)
    if (status !== undefined) {
      this.observeHttpFailure(connectionId, capabilityId, status, endpoint)
      return
    }

    this.update(connectionId, capabilityId, observation => {
      this.addEvidence(observation, `failure:${endpoint}`)
    })
  }

  status(connectionId: string, capabilityId: string): SapCapabilityStatus {
    return this.record(connectionId, capabilityDefinition(capabilityId)).status
  }

  observeDiscovery(connectionId: string, discoveryText: string): void {
    const normalizedDiscovery = discoveryText.toLowerCase()
    for (const definition of CAPABILITY_DEFINITIONS) {
      if (definition.discoveryNeedle &&
        normalizedDiscovery.includes(definition.discoveryNeedle.toLowerCase())) {
        this.observeAdvertised(connectionId, definition.id, definition.discoveryNeedle)
      }
    }
  }

  list(
    connectionId: string,
    discoveryText: string,
    category?: SapCapabilityCategory
  ): SapCapabilityRecord[] {
    this.observeDiscovery(connectionId, discoveryText)
    return CAPABILITY_DEFINITIONS
      .filter(definition => category === undefined || definition.category === category)
      .map(definition => this.record(connectionId, definition))
  }

  private update(
    connectionId: string,
    capabilityId: string,
    apply: (observation: SapCapabilityObservation) => void
  ): void {
    const definition = capabilityDefinition(capabilityId)
    const connectionKey = normalizeId(connectionId)
    const capabilityKey = normalizeId(definition.id)
    let connectionObservations = this.observations.get(connectionKey)
    if (!connectionObservations) {
      connectionObservations = new Map()
      this.observations.set(connectionKey, connectionObservations)
    }

    let observation = connectionObservations.get(capabilityKey)
    if (!observation) {
      observation = { evidence: [], succeeded: false }
      connectionObservations.set(capabilityKey, observation)
    }

    apply(observation)
    observation.lastObservedAt = new Date().toISOString()
  }

  private addEvidence(observation: SapCapabilityObservation, evidence: string): void {
    const retainedEvidence = truncateEvidence(sanitizeSensitiveText(evidence))
    const existingIndex = observation.evidence.indexOf(retainedEvidence)
    if (existingIndex >= 0) observation.evidence.splice(existingIndex, 1)
    observation.evidence.push(retainedEvidence)
    if (observation.evidence.length > 20) {
      observation.evidence.splice(0, observation.evidence.length - 20)
    }
  }

  private record(
    connectionId: string,
    definition: SapCapabilityDefinition
  ): SapCapabilityRecord {
    const observation = this.observations
      .get(normalizeId(connectionId))
      ?.get(normalizeId(definition.id))
    const system = observation?.system ?? "unknown"
    const authorization = observation?.authorization ?? "unknown"
    const status = definition.implementation === "missing" || system === "not_advertised"
      ? "unsupported"
      : observation?.succeeded
        ? "supported"
        : "unverified"

    return {
      id: definition.id,
      category: definition.category,
      implementation: definition.implementation,
      system,
      authorization,
      status,
      evidence: [...(observation?.evidence ?? [])],
      lastObservedAt: observation?.lastObservedAt ?? null
    }
  }
}
