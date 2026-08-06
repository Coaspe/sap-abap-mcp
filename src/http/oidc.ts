import {
  createPublicKey,
  verify,
  type JsonWebKey as NodeJsonWebKey,
  type KeyObject
} from "node:crypto"
import { AppError } from "../errors.js"
import { parseHttpRole, type HttpPrincipal, type HttpRole } from "./auth.js"

/**
 * OIDC/JWT client authentication.
 *
 * Verification is implemented on `node:crypto` alone: JWKs are imported through
 * `createPublicKey({ format: "jwk" })` and signatures checked with `verify`, so
 * this adds no dependency to the runtime.
 *
 * Only asymmetric algorithms are accepted. HMAC (`HS*`) would require the server
 * to hold the signing secret, which turns a verifier into a token issuer, and
 * `none` is rejected outright.
 */

const SUPPORTED_ALGORITHMS = {
  RS256: { name: "RSA-SHA256", padding: undefined },
  RS384: { name: "RSA-SHA384", padding: undefined },
  RS512: { name: "RSA-SHA512", padding: undefined },
  PS256: { name: "RSA-SHA256", padding: "pss" },
  PS384: { name: "RSA-SHA384", padding: "pss" },
  PS512: { name: "RSA-SHA512", padding: "pss" },
  ES256: { name: "SHA256", padding: undefined },
  ES384: { name: "SHA384", padding: undefined },
  ES512: { name: "SHA512", padding: undefined }
} as const

export type SupportedJwtAlgorithm = keyof typeof SUPPORTED_ALGORITHMS

export const DEFAULT_JWKS_CACHE_MS = 5 * 60 * 1000
export const DEFAULT_CLOCK_SKEW_SECONDS = 60
const MAX_TOKEN_BYTES = 16 * 1024
const MAX_JWKS_BYTES = 512 * 1024

export interface JwtClaims {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  [claim: string]: unknown
}

export interface OidcConfiguration {
  issuer: string
  audience: string
  jwksUri: string
  /** Claim carrying role or scope values. Defaults to `scope`. */
  roleClaim?: string
  /** Maps a claim value to a role, for example `sap-admin=admin`. */
  roleMap?: Readonly<Record<string, HttpRole>>
  /** Role used when no mapped value is present. Defaults to `viewer`. */
  defaultRole?: HttpRole
  clockSkewSeconds?: number
  jwksCacheMs?: number
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  return Buffer.from(padded, "base64")
}

function decodeJson(segment: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(base64UrlDecode(segment).toString("utf8"))
  } catch {
    throw new AppError("JWT_MALFORMED", `The JWT ${label} is not valid JSON`)
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("JWT_MALFORMED", `The JWT ${label} is not an object`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Convert an ECDSA JOSE signature (r||s) to the DER encoding `crypto.verify`
 * expects. JOSE uses fixed-width concatenation; DER uses a SEQUENCE of INTEGERs.
 */
function joseToDerSignature(signature: Buffer): Buffer {
  const half = signature.length / 2
  const encodeInteger = (bytes: Buffer): Buffer => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1
    let value = bytes.subarray(start)
    if ((value[0] ?? 0) & 0x80) value = Buffer.concat([Buffer.from([0]), value])
    return Buffer.concat([Buffer.from([0x02, value.length]), value])
  }
  const r = encodeInteger(signature.subarray(0, half))
  const s = encodeInteger(signature.subarray(half))
  const body = Buffer.concat([r, s])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

export interface JwksFetcher {
  (uri: string): Promise<unknown>
}

const defaultJwksFetcher: JwksFetcher = async uri => {
  const response = await fetch(uri, {
    headers: { accept: "application/json" },
    redirect: "error"
  })
  if (!response.ok) {
    throw new AppError(
      "JWKS_FETCH_FAILED",
      `The JWKS endpoint returned HTTP ${response.status}`,
      { jwksUri: uri, httpStatus: response.status }
    )
  }
  const text = await response.text()
  if (Buffer.byteLength(text, "utf8") > MAX_JWKS_BYTES) {
    throw new AppError("JWKS_FETCH_FAILED", "The JWKS document is too large")
  }
  return JSON.parse(text)
}

interface CachedKeys {
  keys: Map<string, KeyObject>
  expiresAt: number
}

/**
 * Fetches and caches the issuer's signing keys. A key id absent from the cache
 * triggers exactly one refresh, which is how key rotation is picked up without
 * allowing an unknown `kid` to cause unbounded fetching.
 */
export class JwksKeyStore {
  private cached: CachedKeys | undefined
  private refreshing: Promise<void> | undefined

  constructor(
    private readonly jwksUri: string,
    private readonly cacheMs: number = DEFAULT_JWKS_CACHE_MS,
    private readonly fetcher: JwksFetcher = defaultJwksFetcher,
    private readonly now: () => number = Date.now
  ) {
    const url = new URL(jwksUri)
    if (url.protocol !== "https:" && url.hostname !== "localhost" &&
      url.hostname !== "127.0.0.1") {
      throw new AppError(
        "JWKS_URI_INVALID",
        "The JWKS URI must use HTTPS outside loopback"
      )
    }
  }

  async get(keyId: string): Promise<KeyObject | undefined> {
    if (!this.cached || this.cached.expiresAt <= this.now()) await this.refresh()
    const hit = this.cached?.keys.get(keyId)
    if (hit) return hit
    // Unknown kid: refresh once in case the issuer rotated keys.
    await this.refresh()
    return this.cached?.keys.get(keyId)
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        const document = await this.fetcher(this.jwksUri)
        const rawKeys = (document as { keys?: unknown })?.keys
        if (!Array.isArray(rawKeys)) {
          throw new AppError("JWKS_INVALID", "The JWKS document has no keys array")
        }
        const keys = new Map<string, KeyObject>()
        for (const entry of rawKeys) {
          const jwk = entry as Record<string, unknown>
          const keyId = typeof jwk.kid === "string" ? jwk.kid : undefined
          if (!keyId || (jwk.use !== undefined && jwk.use !== "sig")) continue
          try {
            keys.set(keyId, createPublicKey({
              key: jwk as unknown as NodeJsonWebKey,
              format: "jwk"
            }))
          } catch {
            // Skip a key this runtime cannot import rather than failing the set.
          }
        }
        this.cached = { keys, expiresAt: this.now() + this.cacheMs }
      } finally {
        this.refreshing = undefined
      }
    })()
    return this.refreshing
  }
}

function audienceMatches(claim: unknown, expected: string): boolean {
  if (typeof claim === "string") return claim === expected
  if (Array.isArray(claim)) return claim.includes(expected)
  return false
}

/** Split a `scope`-style claim, which may be a space-delimited string or array. */
export function claimValues(claim: unknown): string[] {
  if (typeof claim === "string") {
    return claim.split(/[\s,]+/).map(value => value.trim()).filter(Boolean)
  }
  if (Array.isArray(claim)) {
    return claim.filter((value): value is string => typeof value === "string")
  }
  return []
}

const ROLE_RANK: Readonly<Record<HttpRole, number>> = {
  viewer: 0,
  developer: 1,
  admin: 2
}

/**
 * Resolve the role for a verified token. When several mapped values are present,
 * the highest-privilege one wins, matching how an identity provider layers group
 * membership.
 */
export function resolveTokenRole(
  claims: JwtClaims,
  configuration: OidcConfiguration
): HttpRole {
  const values = claimValues(claims[configuration.roleClaim ?? "scope"])
  const map = configuration.roleMap ?? {}
  let resolved: HttpRole | undefined
  for (const value of values) {
    const mapped = map[value]
    if (!mapped) continue
    if (!resolved || ROLE_RANK[mapped] > ROLE_RANK[resolved]) resolved = mapped
  }
  return resolved ?? configuration.defaultRole ?? "viewer"
}

export function parseOidcRoleMap(
  value: string | undefined
): Record<string, HttpRole> {
  if (!value || value.trim().length === 0) return {}
  const map: Record<string, HttpRole> = {}
  for (const entry of value.split(",")) {
    const [claimValue, role] = entry.split("=").map(part => part?.trim())
    if (!claimValue || !role) {
      throw new AppError(
        "OIDC_ROLE_MAP_INVALID",
        `--oidc-role-map entries must be <claimValue>=<role>: ${entry}`
      )
    }
    map[claimValue] = parseHttpRole(role)
  }
  return map
}

export interface VerifiedToken {
  claims: JwtClaims
  role: HttpRole
  subject: string
}

/**
 * Verify a JWT against the configured issuer, audience, and signing keys.
 * Throws an AppError describing the first failed check.
 */
export async function verifyJwt(
  token: string,
  configuration: OidcConfiguration,
  keys: JwksKeyStore,
  now: () => number = Date.now
): Promise<VerifiedToken> {
  if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
    throw new AppError("JWT_MALFORMED", "The token is too large")
  }
  const parts = token.split(".")
  if (parts.length !== 3) {
    throw new AppError("JWT_MALFORMED", "A JWT must have three segments")
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string]
  const header = decodeJson(headerSegment, "header")
  const algorithm = header.alg
  if (typeof algorithm !== "string" || !(algorithm in SUPPORTED_ALGORITHMS)) {
    throw new AppError(
      "JWT_ALGORITHM_UNSUPPORTED",
      `Unsupported JWT algorithm: ${String(algorithm)}`,
      { supported: Object.keys(SUPPORTED_ALGORITHMS) }
    )
  }
  const keyId = header.kid
  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new AppError("JWT_MALFORMED", "The JWT header has no kid")
  }
  const key = await keys.get(keyId)
  if (!key) {
    throw new AppError("JWT_KEY_UNKNOWN", "No signing key matches the token kid")
  }

  const spec = SUPPORTED_ALGORITHMS[algorithm as SupportedJwtAlgorithm]
  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8")
  let signature = base64UrlDecode(signatureSegment)
  if (algorithm.startsWith("ES")) signature = joseToDerSignature(signature)
  const verified = verify(
    spec.name,
    signingInput,
    spec.padding === "pss"
      ? { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 0 /* DIGEST */ }
      : key,
    signature
  )
  if (!verified) {
    throw new AppError("JWT_SIGNATURE_INVALID", "The JWT signature is not valid")
  }

  const claims = decodeJson(payloadSegment, "payload") as JwtClaims
  if (claims.iss !== configuration.issuer) {
    throw new AppError("JWT_ISSUER_MISMATCH", "The JWT issuer is not accepted")
  }
  if (!audienceMatches(claims.aud, configuration.audience)) {
    throw new AppError("JWT_AUDIENCE_MISMATCH", "The JWT audience is not accepted")
  }
  const skew = configuration.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  const seconds = Math.floor(now() / 1000)
  if (typeof claims.exp !== "number") {
    throw new AppError("JWT_EXPIRY_REQUIRED", "The JWT has no exp claim")
  }
  if (claims.exp + skew < seconds) {
    throw new AppError("JWT_EXPIRED", "The JWT has expired")
  }
  if (typeof claims.nbf === "number" && claims.nbf - skew > seconds) {
    throw new AppError("JWT_NOT_YET_VALID", "The JWT is not valid yet")
  }
  const subject = typeof claims.sub === "string" && claims.sub.length > 0
    ? claims.sub
    : undefined
  if (!subject) {
    throw new AppError("JWT_SUBJECT_REQUIRED", "The JWT has no sub claim")
  }

  return { claims, role: resolveTokenRole(claims, configuration), subject }
}

export interface OidcAuthenticator {
  resolve(credential: string): Promise<HttpPrincipal>
}

export function createOidcAuthenticator(
  configuration: OidcConfiguration,
  keys: JwksKeyStore = new JwksKeyStore(
    configuration.jwksUri,
    configuration.jwksCacheMs
  ),
  now: () => number = Date.now
): OidcAuthenticator {
  return {
    resolve: async credential => {
      const { subject, role, claims } = await verifyJwt(
        credential,
        configuration,
        keys,
        now
      )
      return {
        id: subject,
        role,
        source: "oidc",
        ...(typeof claims.preferred_username === "string"
          ? { username: claims.preferred_username }
          : {})
      }
    }
  }
}
