import { isAdtError, isHttpError, ValidateObjectUrl, type ADTClient, type ObjectVersion } from "abap-adt-api"
import { AppError } from "./errors.js"

type RequestOptions = NonNullable<Parameters<ADTClient["httpClient"]["request"]>[1]>
type HttpClientResponse = Awaited<ReturnType<ADTClient["httpClient"]["request"]>>

const MAX_ENTRIES = 64
const MAX_BYTES = 8 * 1024 * 1024
const MAX_ENTRY_BYTES = 512 * 1024

interface Entry {
  source: string
  etag: string
  bytes: number
}

function header(response: HttpClientResponse, name: string): string | undefined {
  const value = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name)?.[1]
  return typeof value === "string" ? value : undefined
}

/** Per-connection memory only. Every cache hit is revalidated by SAP. */
export class SourceCache {
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<{ source: string; reusable: boolean }>>()
  private bytes = 0
  private generation = 0

  constructor(private readonly request: (uri: string, options: RequestOptions) => Promise<HttpClientResponse>) {}

  clear(): void {
    this.entries.clear()
    this.pending.clear()
    this.bytes = 0
    this.generation += 1
  }

  private remove(key: string): void {
    this.bytes -= this.entries.get(key)?.bytes ?? 0
    this.entries.delete(key)
  }

  async read(uri: string, version?: ObjectVersion, accept?: string): Promise<string> {
    ValidateObjectUrl(uri)
    const key = JSON.stringify([uri, version ?? null, accept ?? null])
    const generation = this.generation
    const existing = this.pending.get(key)
    if (existing) {
      const result = await existing
      if (generation !== this.generation) throw new AppError("SOURCE_CHANGED", "Source read overlapped a local mutation; read again")
      if (result.reusable) return result.source
      // A non-storable response cannot satisfy another collapsed request.
      const forwarded = await this.load(key, uri, version, accept)
      if (generation !== this.generation) throw new AppError("SOURCE_CHANGED", "Source read overlapped a local mutation; read again")
      return forwarded.source
    }
    const pending = this.load(key, uri, version, accept)
    this.pending.set(key, pending)
    try {
      const result = await pending
      if (generation !== this.generation) throw new AppError("SOURCE_CHANGED", "Source read overlapped a local mutation; read again")
      return result.source
    }
    finally { if (this.pending.get(key) === pending) this.pending.delete(key) }
  }

  private async load(key: string, uri: string, version?: ObjectVersion, accept?: string): Promise<{ source: string; reusable: boolean }> {
    const cached = this.entries.get(key)
    const generation = this.generation
    const headers: Record<string, string> = {}
    if (accept !== undefined) headers.Accept = accept
    if (cached) headers["If-None-Match"] = cached.etag
    let response: HttpClientResponse
    let validationHeadersAvailable = true
    try {
      response = await this.request(uri, {
        ...(version ? { qs: { version } } : {}),
        ...(Object.keys(headers).length ? { headers } : {})
      })
    } catch (error) {
      // abap-adt-api's Axios transport rejects HTTP 304 as an exception.
      if ((isHttpError(error) && error.status === 304) || (isAdtError(error) && error.err === 304)) {
        const responseHeaders = isAdtError(error)
          ? error.response?.headers
          : isHttpError(error)
            ? (error.parent as Error & { response?: { headers?: HttpClientResponse["headers"] } }).response?.headers
            : undefined
        validationHeadersAvailable = responseHeaders !== undefined
        response = { status: 304, statusText: "Not Modified", body: "", headers: responseHeaders ?? {} }
      } else {
        if (generation === this.generation) this.remove(key)
        throw error
      }
    }
    if (generation !== this.generation) {
      throw new AppError("SOURCE_CHANGED", "Source read overlapped a local mutation; read again")
    }
    if (response.status === 304 && cached) {
      const etag = header(response, "etag")
      if (etag !== undefined && etag.replace(/^W\//, "") !== cached.etag.replace(/^W\//, "")) {
        this.remove(key)
        throw new AppError("SOURCE_CHANGED", "Revalidation returned a different source validator; read again")
      }
      if (!validationHeadersAvailable || /\bno-store\b/i.test(header(response, "cache-control") ?? "") ||
          header(response, "vary")?.split(",").some(value => value.trim() === "*")) {
        this.remove(key)
      } else {
        this.entries.delete(key)
        this.entries.set(key, { ...cached, etag: etag ?? cached.etag })
      }
      return { source: cached.source, reusable: this.entries.has(key) }
    }
    this.remove(key)
    if (response.status !== 200) {
      throw new AppError("SOURCE_READ_FAILED", "Expected a complete source response", { httpStatus: response.status })
    }
    const etag = header(response, "etag")
    const bytes = Buffer.byteLength(response.body, "utf8")
    const cacheControl = header(response, "cache-control") ?? ""
    if (etag && etag.length <= 1024 && !/[\r\n]/.test(etag) &&
        !/\bno-store\b/i.test(cacheControl) && !header(response, "vary")?.split(",").some(value => value.trim() === "*") &&
        bytes <= MAX_ENTRY_BYTES) {
      this.entries.set(key, { source: response.body, etag, bytes })
      this.bytes += bytes
      while (this.entries.size > MAX_ENTRIES || this.bytes > MAX_BYTES) {
        this.remove(this.entries.keys().next().value!)
      }
    }
    return { source: response.body, reusable: this.entries.has(key) }
  }
}
