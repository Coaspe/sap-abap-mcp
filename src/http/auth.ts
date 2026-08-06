import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { AppError } from "../errors.js"
import { trimTrailingLineBreaks } from "../text.js"

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

/**
 * One stored key. Exactly one digest field is present, and it names the
 * algorithm, so a key file states how it was produced instead of depending on
 * server configuration matching by luck.
 *
 * `keyHmacSha256` binds the digest to a server-side secret, so a disclosed key
 * file alone cannot be attacked offline. That is the residual risk a length rule
 * cannot remove: a validator cannot tell a long random key from a long
 * hand-written one.
 */
export interface ApiKeyRecord {
  id: string
  role: HttpRole
  keySha256?: string
  keyHmacSha256?: string
  /**
   * SAP profiles this key may select. Assigning one profile per person is how a
   * deployment gets per-user SAP identity: SAP change documents and
   * authorization checks then apply to that person's own SAP user.
   */
  systemIds?: readonly string[]
}

/** Minimum length for the server-side secret used by `keyHmacSha256`. */
export const API_KEY_PEPPER_MIN_LENGTH = 32

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
 * Digest a key under a server-side secret.
 *
 * This closes the one risk {@link isWellFormedApiKey} cannot: a key that is long
 * enough to pass validation but not actually random. Without the secret, a
 * disclosed key file cannot be attacked offline at all, whatever the key's
 * entropy. It stays fast, so it does not reintroduce the denial-of-service
 * concern a per-request KDF would.
 *
 * The secret must not live beside the key file, or a single disclosure yields
 * both.
 */
export function hmacApiKey(key: string, pepper: string): string {
  if (pepper.length < API_KEY_PEPPER_MIN_LENGTH) {
    throw new AppError(
      "API_KEY_PEPPER_TOO_SHORT",
      `The API key secret must be at least ${API_KEY_PEPPER_MIN_LENGTH} characters`
    )
  }
  return createHmac("sha256", pepper).update(key, "utf8").digest("hex")
}

/** Read a server-side secret from a file, ignoring a trailing newline. */
export function loadApiKeyPepper(path: string): string {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    throw new AppError(
      "API_KEY_PEPPER_UNREADABLE",
      `The API key secret file could not be read: ${path}`,
      { cause: error instanceof Error ? error.message : String(error) }
    )
  }
  const pepper = trimTrailingLineBreaks(text)
  if (pepper.length < API_KEY_PEPPER_MIN_LENGTH) {
    throw new AppError(
      "API_KEY_PEPPER_TOO_SHORT",
      `The API key secret must be at least ${API_KEY_PEPPER_MIN_LENGTH} characters`
    )
  }
  return pepper
}

/** Generate a server-side secret suitable for {@link hmacApiKey}. */
export function generateApiKeyPepper(): string {
  return randomBytes(API_KEY_BYTES).toString("base64url")
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
    const readDigest = (field: "keySha256" | "keyHmacSha256"): string | undefined => {
      const raw = record[field]
      if (raw === undefined) return undefined
      const digest = typeof raw === "string" ? raw.trim().toLowerCase() : ""
      if (!/^[0-9a-f]+$/.test(digest) || digest.length !== SHA256_HEX_LENGTH) {
        throw new AppError(
          "API_KEY_FILE_INVALID",
          `keys[${index}].${field} must be a 64-character hex digest`
        )
      }
      return digest
    }
    const keySha256 = readDigest("keySha256")
    const keyHmacSha256 = readDigest("keyHmacSha256")
    // Exactly one digest, so the record states its own algorithm and a file can
    // never be ambiguous about which secret, if any, is required to verify it.
    if ((keySha256 === undefined) === (keyHmacSha256 === undefined)) {
      throw new AppError(
        "API_KEY_FILE_INVALID",
        `keys[${index}] must set exactly one of keySha256 or keyHmacSha256`
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
      ...(keySha256 !== undefined ? { keySha256 } : {}),
      ...(keyHmacSha256 !== undefined ? { keyHmacSha256 } : {}),
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
 * Resolve the principal for a presented credential. Comparison always digests
 * the presented value first and then compares fixed-length digests with
 * `timingSafeEqual`, so no comparison leaks key content through timing.
 *
 * A record verifies under the algorithm it names. A `keyHmacSha256` record
 * without the server-side secret is skipped rather than downgraded to a plain
 * hash, so a missing secret denies access instead of weakening verification.
 */
export function resolveApiKeyPrincipal(
  records: readonly ApiKeyRecord[],
  credential: string | undefined,
  pepper?: string
): HttpPrincipal | undefined {
  if (!credential || !isWellFormedApiKey(credential)) return undefined
  const plain = Buffer.from(hashApiKey(credential), "hex")
  const peppered = pepper ? Buffer.from(hmacApiKey(credential, pepper), "hex") : undefined
  let matched: ApiKeyRecord | undefined
  for (const record of records) {
    const stored = record.keyHmacSha256 ?? record.keySha256
    const presented = record.keyHmacSha256 !== undefined ? peppered : plain
    if (stored === undefined || presented === undefined) continue
    const expected = Buffer.from(stored, "hex")
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
