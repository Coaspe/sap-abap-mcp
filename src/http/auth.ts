import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { AppError } from "../errors.js"

export const HTTP_ROLES = ["viewer", "developer", "admin"] as const
export type HttpRole = (typeof HTTP_ROLES)[number]

const API_KEY_BYTES = 32
/**
 * 32 random bytes encode to 43 base64url characters. Requiring at least that
 * many characters from the base64url alphabet keeps a hand-written short key out
 * of the store, which is the case a fast hash cannot defend on its own.
 */
const API_KEY_MIN_LENGTH = 43
const API_KEY_PATTERN = /^[A-Za-z0-9_-]+$/
const SHA256_HEX_LENGTH = 64
const PRINCIPAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/

export type HttpPrincipalSource = "api-key" | "oidc"

export interface HttpPrincipal {
  id: string
  role: HttpRole
  source: HttpPrincipalSource
  /** Human-readable name from the identity provider, when it supplies one. */
  username?: string
  /**
   * SAP profiles this principal may select. When undefined every configured
   * profile is reachable, which is the single-identity default.
   */
  systemIds?: readonly string[]
}

export interface ApiKeyRecord {
  id: string
  role: HttpRole
  keySha256: string
  /**
   * SAP profiles this key may select. Assigning one profile per person is how a
   * deployment gets per-user SAP identity: SAP change documents and
   * authorization checks then apply to that person's own SAP user.
   */
  systemIds?: readonly string[]
}

export function parseHttpRole(value: unknown): HttpRole {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if ((HTTP_ROLES as readonly string[]).includes(normalized)) {
      return normalized as HttpRole
    }
  }
  throw new AppError(
    "INVALID_ROLE",
    `Unknown role: ${String(value)}`,
    { available: [...HTTP_ROLES] }
  )
}

/**
 * Hash an API key for storage and comparison.
 *
 * SHA-256 is the correct primitive here, and a slow KDF such as scrypt or argon2
 * would be the wrong one, for two reasons.
 *
 * A key is 32 bytes from a CSPRNG, so it carries 256 bits of entropy. No amount
 * of iteration hardening changes the feasibility of searching that space, which
 * is why high-entropy bearer tokens are conventionally stored under a fast hash
 * while human-chosen passwords are not. {@link isWellFormedApiKey} enforces the
 * length and alphabet that entropy claim depends on, so a short hand-written
 * value cannot enter the store.
 *
 * Deriving a key on every request would also turn authentication into a
 * denial-of-service amplifier: requests are rate limited per principal, so an
 * unauthenticated caller is not yet rate limited when its credential is hashed.
 * A deliberately expensive hash there lets an unauthenticated caller consume CPU
 * at will.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

/**
 * Generate a new URL-safe API key from 32 CSPRNG bytes. The raw value is
 * returned once and never persisted; only its digest is stored.
 */
export function generateApiKey(): string {
  return randomBytes(API_KEY_BYTES).toString("base64url")
}

/**
 * Whether a presented credential has the shape `generateApiKey` produces.
 *
 * A validator cannot measure the entropy of a string, so this raises the floor
 * rather than proving strength: it rejects values too short or outside the
 * base64url alphabet to be a generated key. Keys must come from
 * `sap-abap-mcp apikey new` or an equivalent CSPRNG.
 */
export function isWellFormedApiKey(value: string): boolean {
  return value.length >= API_KEY_MIN_LENGTH && API_KEY_PATTERN.test(value)
}

/**
 * Parse an API key file. The file stores only SHA-256 hashes of keys, so a
 * disclosed configuration file does not disclose usable credentials.
 */
export function parseApiKeyFile(text: string): ApiKeyRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new AppError(
      "API_KEY_FILE_INVALID",
      "The API key file is not valid JSON",
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
  const keys = (parsed as { keys?: unknown })?.keys
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new AppError(
      "API_KEY_FILE_INVALID",
      "The API key file must contain a non-empty \"keys\" array"
    )
  }
  const records = keys.map((entry, index) => {
    const record = entry as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id.trim() : ""
    if (!PRINCIPAL_ID_PATTERN.test(id)) {
      throw new AppError(
        "API_KEY_FILE_INVALID",
        `keys[${index}].id must match ${PRINCIPAL_ID_PATTERN.source}`
      )
    }
    const keySha256 = typeof record.keySha256 === "string"
      ? record.keySha256.trim().toLowerCase()
      : ""
    if (!/^[0-9a-f]+$/.test(keySha256) || keySha256.length !== SHA256_HEX_LENGTH) {
      throw new AppError(
        "API_KEY_FILE_INVALID",
        `keys[${index}].keySha256 must be a 64-character SHA-256 hex digest`
      )
    }
    const rawSystemIds = record.systemIds
    if (rawSystemIds !== undefined && !Array.isArray(rawSystemIds)) {
      throw new AppError(
        "API_KEY_FILE_INVALID",
        `keys[${index}].systemIds must be an array of SAP profile ids`
      )
    }
    const systemIds = rawSystemIds
      ?.map(value => (typeof value === "string" ? value.trim().toUpperCase() : ""))
      .filter(Boolean)
    if (rawSystemIds !== undefined && (systemIds?.length ?? 0) === 0) {
      throw new AppError(
        "API_KEY_FILE_INVALID",
        `keys[${index}].systemIds must contain at least one SAP profile id`
      )
    }
    return {
      id,
      role: parseHttpRole(record.role),
      keySha256,
      ...(systemIds ? { systemIds } : {})
    }
  })
  const duplicate = records.find(
    (record, index) => records.findIndex(other => other.id === record.id) !== index
  )
  if (duplicate) {
    throw new AppError(
      "API_KEY_FILE_INVALID",
      `Duplicate API key id: ${duplicate.id}`
    )
  }
  return records
}

export function loadApiKeyRecords(path: string): ApiKeyRecord[] {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    throw new AppError(
      "API_KEY_FILE_UNREADABLE",
      `The API key file could not be read: ${path}`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
  return parseApiKeyFile(text)
}

/**
 * Read a Bearer credential from an Authorization header value. Returns
 * undefined when the header is absent or does not use the Bearer scheme.
 */
export function bearerCredential(header: string | undefined): string | undefined {
  if (typeof header !== "string") return undefined
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim())
  const credential = match?.[1]?.trim()
  return credential && credential.length > 0 ? credential : undefined
}

/**
 * Resolve the principal for a presented credential. Comparison always hashes
 * the presented value first and then compares fixed-length digests with
 * `timingSafeEqual`, so no comparison leaks key content through timing.
 */
export function resolveApiKeyPrincipal(
  records: readonly ApiKeyRecord[],
  credential: string | undefined
): HttpPrincipal | undefined {
  if (!credential || !isWellFormedApiKey(credential)) return undefined
  const presented = Buffer.from(hashApiKey(credential), "hex")
  let matched: ApiKeyRecord | undefined
  for (const record of records) {
    const expected = Buffer.from(record.keySha256, "hex")
    if (
      expected.length === presented.length &&
      timingSafeEqual(expected, presented)
    ) {
      matched = record
    }
  }
  if (!matched) return undefined
  return {
    id: matched.id,
    role: matched.role,
    source: "api-key",
    ...(matched.systemIds ? { systemIds: matched.systemIds } : {})
  }
}

export const API_KEY_MINIMUM_LENGTH = API_KEY_MIN_LENGTH
