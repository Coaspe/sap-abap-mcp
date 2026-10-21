import { readFileSync, statSync } from "node:fs"
import { isAbsolute } from "node:path"
import { Agent } from "node:https"
import * as tls from "node:tls"
import { X509Certificate } from "node:crypto"
import { AppError } from "./errors.js"

export function readCaFile(path: string): string {
  try {
    if (!isAbsolute(path)) throw new Error()
    const info = statSync(path)
    if (!info.isFile() || info.size > 1024 * 1024) throw new Error()
    const pem = readFileSync(path, "utf8")
    if (Buffer.byteLength(pem) > 1024 * 1024) throw new Error()
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    if (!certificates?.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, "").trim()) throw new Error()
    for (const certificate of certificates) new X509Certificate(certificate)
    return pem
  } catch {
    throw new AppError("CA_FILE_INVALID", "Use an absolute path to a readable PEM certificate file (at most 1 MiB, no private keys).")
  }
}

export function profileHttpsAgent(caFile: string): Agent {
  const roots = typeof tls.getCACertificates === "function" ? tls.getCACertificates("default") : tls.rootCertificates
  return new Agent({ keepAlive: true, rejectUnauthorized: true, ca: [...roots, readCaFile(caFile)] })
}

const UNTRUSTED = new Set(["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_UNTRUSTED"])
export function certificateErrorCode(error: unknown, seen = new Set<unknown>()): string | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) return undefined
  seen.add(error)
  const item = error as { code?: unknown; parent?: unknown; cause?: unknown }
  if (typeof item.code === "string" && (UNTRUSTED.has(item.code) || ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(item.code))) return item.code
  return certificateErrorCode(item.parent, seen) ?? certificateErrorCode(item.cause, seen)
}

export function systemCaHint(): string {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number)
  const hints = ["Ask your SAP administrator for the company CA PEM file and set --ca-file <absolute-path>."]
  if (process.allowedNodeEnvironmentFlags.has("--use-system-ca")) hints.push("If the company CA is in the operating system trust store, restart Node with --use-system-ca.")
  if (major > 24 || (major === 24 && minor >= 6) || (major === 22 && minor >= 19)) hints.push("You can also restart Node with NODE_USE_SYSTEM_CA=1.")
  return hints.join(" ")
}

export function certificateFailure(error: unknown): AppError | undefined {
  const code = certificateErrorCode(error)
  if (!code) return undefined
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return new AppError("SAP_TLS_HOSTNAME_MISMATCH", "The SAP URL hostname does not match its certificate. Ask the administrator for the correct HTTPS URL.")
  if (code === "CERT_HAS_EXPIRED" || code === "CERT_NOT_YET_VALID") return new AppError("SAP_TLS_CERTIFICATE_EXPIRED", "The SAP certificate is expired or not yet valid. Check the computer clock and ask the administrator to renew the certificate.")
  return new AppError("SAP_TLS_CERTIFICATE_UNTRUSTED", `The SAP certificate is not trusted. ${systemCaHint()}`)
}

export function globalTlsVerificationDisabled(): boolean {
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
}
