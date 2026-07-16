import { randomUUID } from "node:crypto"
import { AppError } from "./errors.js"

export const DEFERRED_RESULT_TOOL_NAME = "read_deferred_result"
export const DEFERRED_RESULT_INLINE_BYTE_LIMIT = 16 * 1024
export const DEFERRED_RESULT_PREVIEW_BYTE_LIMIT = 8 * 1024
export const DEFERRED_RESULT_ENVELOPE_BYTE_LIMIT = 12 * 1024
export const DEFERRED_RESULT_CHUNK_BYTE_LIMIT = 24 * 1024
export const DEFERRED_RESULT_MIN_CHUNK_BYTES = 4
export const DEFERRED_RESULT_TTL_MS = 10 * 60 * 1000
export const DEFERRED_RESULT_MAX_ENTRIES = 20
export const DEFERRED_RESULT_MAX_CACHE_BYTES = 8 * 1024 * 1024

export interface DeferredErrorSummary {
  code: string
  message: string
  status?: string | number
  endpoint?: string
}

export interface DeferredResultEnvelope {
  format: "compact-v1"
  deferred: true
  originalBytes: number
  previewText: string
  previewBytes: number
  resultId: string
  nextOffset: number
  expiresInSeconds: number
  readTool: typeof DEFERRED_RESULT_TOOL_NAME
  summary?: unknown
  error?: DeferredErrorSummary
}

export interface DeferredResultChunk {
  resultId: string
  content: string
  offset: number
  returnedBytes: number
  totalBytes: number
  nextOffset: number | null
  done: boolean
}

interface DeferredResultEntry {
  bytes: Buffer
  createdAt: number
  expiresAt: number
}

export interface DeferredResultStoreOptions {
  inlineByteLimit?: number
  previewByteLimit?: number
  envelopeByteLimit?: number
  chunkByteLimit?: number
  ttlMs?: number
  maxEntries?: number
  maxCacheBytes?: number
  now?: () => number
}

export interface DeferredResultOptions {
  inlineByteLimit?: number
  previewByteLimit?: number
  summary?: unknown
  createSummary?: () => unknown
}

function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80
}

function utf8SafeEnd(bytes: Buffer, start: number, maxBytes: number): number {
  let end = Math.min(bytes.length, start + maxBytes)
  if (end === bytes.length) return end
  while (end > start && isContinuationByte(bytes[end])) end -= 1
  return end
}

export class DeferredResultStore {
  private readonly entries = new Map<string, DeferredResultEntry>()
  private readonly inlineByteLimit: number
  private readonly previewByteLimit: number
  private readonly envelopeByteLimit: number
  private readonly chunkByteLimit: number
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly maxCacheBytes: number
  private readonly now: () => number
  private cachedBytes = 0

  constructor(options: DeferredResultStoreOptions = {}) {
    this.inlineByteLimit = options.inlineByteLimit ?? DEFERRED_RESULT_INLINE_BYTE_LIMIT
    this.previewByteLimit = options.previewByteLimit ?? DEFERRED_RESULT_PREVIEW_BYTE_LIMIT
    this.envelopeByteLimit = options.envelopeByteLimit ?? DEFERRED_RESULT_ENVELOPE_BYTE_LIMIT
    this.chunkByteLimit = options.chunkByteLimit ?? DEFERRED_RESULT_CHUNK_BYTE_LIMIT
    this.ttlMs = options.ttlMs ?? DEFERRED_RESULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFERRED_RESULT_MAX_ENTRIES
    this.maxCacheBytes = options.maxCacheBytes ?? DEFERRED_RESULT_MAX_CACHE_BYTES
    this.now = options.now ?? Date.now
  }

  defer(
    text: string,
    error?: DeferredErrorSummary,
    options: DeferredResultOptions = {}
  ): DeferredResultEnvelope | undefined {
    const originalBytes = Buffer.byteLength(text, "utf8")
    const inlineByteLimit = options.inlineByteLimit ?? this.inlineByteLimit
    if (originalBytes <= inlineByteLimit || originalBytes > this.maxCacheBytes) {
      return undefined
    }
    const bytes = Buffer.from(text, "utf8")
    const summary = options.createSummary ? options.createSummary() : options.summary

    const now = this.now()
    this.removeExpired(now)
    while (
      this.entries.size >= this.maxEntries ||
      this.cachedBytes + bytes.length > this.maxCacheBytes
    ) {
      if (!this.removeOldest()) return undefined
    }

    const resultId = randomUUID()
    const entry = { bytes, createdAt: now, expiresAt: now + this.ttlMs }
    this.entries.set(resultId, entry)
    this.cachedBytes += bytes.length

    const envelope = this.createEnvelope(
      resultId,
      entry,
      error,
      summary,
      options.previewByteLimit
    )
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > this.envelopeByteLimit) {
      this.remove(resultId)
      return undefined
    }
    return envelope
  }

  read(resultId: string, offset = 0, maxBytes = this.chunkByteLimit): DeferredResultChunk {
    const entry = this.entries.get(resultId)
    if (!entry) {
      this.removeExpired(this.now())
      throw new AppError(
        "DEFERRED_RESULT_NOT_FOUND",
        `Deferred result ${resultId} was not found or has been evicted`
      )
    }

    const now = this.now()
    if (entry.expiresAt <= now) {
      this.remove(resultId)
      this.removeExpired(now)
      throw new AppError(
        "DEFERRED_RESULT_EXPIRED",
        `Deferred result ${resultId} has expired`
      )
    }
    this.removeExpired(now, resultId)

    if (
      !Number.isInteger(maxBytes) ||
      maxBytes < DEFERRED_RESULT_MIN_CHUNK_BYTES ||
      maxBytes > this.chunkByteLimit
    ) {
      throw new AppError(
        "DEFERRED_RESULT_CHUNK_SIZE_INVALID",
        `maxBytes must be an integer from ${DEFERRED_RESULT_MIN_CHUNK_BYTES} through ${this.chunkByteLimit}`
      )
    }
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > entry.bytes.length ||
      isContinuationByte(entry.bytes[offset])
    ) {
      throw new AppError(
        "DEFERRED_RESULT_OFFSET_INVALID",
        `offset must be a UTF-8 boundary from 0 through ${entry.bytes.length}`
      )
    }

    let chunkBytes = maxBytes
    while (true) {
      const end = utf8SafeEnd(entry.bytes, offset, chunkBytes)
      const done = end >= entry.bytes.length
      const chunk = {
        resultId,
        content: entry.bytes.subarray(offset, end).toString("utf8"),
        offset,
        returnedBytes: end - offset,
        totalBytes: entry.bytes.length,
        nextOffset: done ? null : end,
        done
      }
      const serializedBytes = Buffer.byteLength(JSON.stringify(chunk), "utf8")
      if (serializedBytes <= DEFERRED_RESULT_INLINE_BYTE_LIMIT) return chunk
      chunkBytes = Math.max(
        DEFERRED_RESULT_MIN_CHUNK_BYTES,
        chunkBytes - Math.max(256, serializedBytes - DEFERRED_RESULT_INLINE_BYTE_LIMIT)
      )
    }
  }

  private createEnvelope(
    resultId: string,
    entry: DeferredResultEntry,
    error?: DeferredErrorSummary,
    summary?: unknown,
    previewByteLimit?: number
  ): DeferredResultEnvelope {
    let previewLimit = Math.min(
      previewByteLimit ?? this.previewByteLimit,
      entry.bytes.length
    )
    while (true) {
      const previewBytes = utf8SafeEnd(entry.bytes, 0, previewLimit)
      const envelope: DeferredResultEnvelope = {
        format: "compact-v1",
        deferred: true,
        originalBytes: entry.bytes.length,
        previewText: entry.bytes.subarray(0, previewBytes).toString("utf8"),
        previewBytes,
        resultId,
        nextOffset: previewBytes,
        expiresInSeconds: Math.ceil(this.ttlMs / 1000),
        readTool: DEFERRED_RESULT_TOOL_NAME,
        ...(summary !== undefined ? { summary } : {}),
        ...(error ? { error } : {})
      }
      const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8")
      if (envelopeBytes <= this.envelopeByteLimit || previewLimit === 0) return envelope
      previewLimit = Math.max(0, previewLimit - Math.max(256, envelopeBytes - this.envelopeByteLimit))
    }
  }

  private removeExpired(now: number, exceptResultId?: string): void {
    for (const [resultId, entry] of this.entries) {
      if (resultId !== exceptResultId && entry.expiresAt <= now) this.remove(resultId)
    }
  }

  private removeOldest(): boolean {
    let oldestId: string | undefined
    let oldestCreatedAt = Number.POSITIVE_INFINITY
    for (const [resultId, entry] of this.entries) {
      if (entry.createdAt < oldestCreatedAt) {
        oldestId = resultId
        oldestCreatedAt = entry.createdAt
      }
    }
    if (!oldestId) return false
    this.remove(oldestId)
    return true
  }

  private remove(resultId: string): void {
    const entry = this.entries.get(resultId)
    if (!entry) return
    this.entries.delete(resultId)
    this.cachedBytes -= entry.bytes.length
  }
}
