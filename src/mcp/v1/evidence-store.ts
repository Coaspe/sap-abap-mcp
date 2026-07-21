import { randomUUID } from "node:crypto"
import { AppError } from "../../errors.js"
import { parseEvidenceResourceUri } from "./resource-uri.js"
import { sanitizeV1DiagnosticValue } from "./result.js"

const MAX_ENTRIES = 100
const MAX_ARTIFACT_BYTES = 256 * 1024
const TTL_MS = 15 * 60 * 1000

interface EvidenceEntry {
  expiresAt: number
  text: string
}

function boundedJson(value: unknown): string {
  const text = JSON.stringify(sanitizeV1DiagnosticValue(value)) ?? "null"
  if (Buffer.byteLength(text, "utf8") <= MAX_ARTIFACT_BYTES) return text
  const preview = Buffer.from(text, "utf8")
    .subarray(0, MAX_ARTIFACT_BYTES - 1024)
    .toString("utf8")
  return JSON.stringify({
    truncated: true,
    originalBytes: Buffer.byteLength(text, "utf8"),
    preview
  })
}

export class V1EvidenceStore {
  readonly runId = randomUUID()
  private readonly entries = new Map<string, EvidenceEntry>()
  private sequence = 0

  put(artifact: string, value: unknown): string {
    this.purge()
    this.sequence += 1
    const slug = artifact.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")
    const key = `${slug || "artifact"}-${this.sequence}`
    this.entries.set(key, {
      expiresAt: Date.now() + TTL_MS,
      text: boundedJson(value)
    })
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return `sap-evidence://${this.runId}/${key}`
  }

  read(value: string): { uri: string; text: string; expiresAt: string } {
    this.purge()
    const parsed = parseEvidenceResourceUri(value)
    if (parsed.runId !== this.runId) {
      throw new AppError("INVALID_ADT_URI", "Evidence belongs to another MCP session")
    }
    const entry = this.entries.get(parsed.artifact)
    if (entry === undefined) {
      throw new AppError("INVALID_ADT_URI", "Evidence artifact is unavailable or expired")
    }
    return {
      uri: parsed.canonicalUri,
      text: entry.text,
      expiresAt: new Date(entry.expiresAt).toISOString()
    }
  }

  private purge(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }
}
