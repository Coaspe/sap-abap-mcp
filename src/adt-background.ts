import { fullParse, xmlArray, xmlNode } from "abap-adt-api/build/utilities.js"
import { XMLValidator } from "fast-xml-parser"
import type { RequestOptions, HttpClientResponse } from "abap-adt-api/build/AdtHTTP.js"
import { AppError } from "./errors.js"

type Request = (uri: string, options: RequestOptions) => Promise<HttpClientResponse>
const BASE = "/sap/bc/adt/communication/bgruns/runs"
const DISCOVERY = "/sap/bc/adt/core/discovery"
const MEDIA = "application/vnd.sap.adt.bgrun.v1+xml"

export function withAdtPhase(error: unknown, details: Record<string, unknown>): unknown {
  if (error instanceof AppError) return new AppError(error.code, error.message, { ...error.details, ...details })
  if (!(error instanceof Error)) return error
  const transport = error as Error & { status?: number; err?: number; response?: { status?: number } }
  const httpStatus = transport.response?.status ?? transport.status ?? transport.err
  if (!Number.isInteger(httpStatus) || httpStatus! < 100 || httpStatus! > 599) return error
  const code = httpStatus === 401 ? "AUTH_REQUIRED" : httpStatus === 403 ? "SAP_AUTHORIZATION_DENIED" : "SAP_OPERATION_FAILED"
  return new AppError(code, error.message, { httpStatus, ...details })
}

function adtUrl(value: unknown, base: URL, origin: string): URL {
  if (typeof value !== "string" || !value) throw new AppError("ADT_BACKGROUND_INVALID", "SAP did not return a background-run URI")
  let url: URL
  try { url = new URL(value, base) } catch { throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned a malformed background-run URI") }
  if (url.origin !== origin || url.username || url.password || url.hash ||
      !url.pathname.startsWith("/sap/bc/adt/") || /%2f|%5c|%2e|%25/i.test(url.pathname) || /[\\\r\n\t]/.test(value)) {
    throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned a background-run URI outside this system's background-run resource")
  }
  return url
}

export async function discoverAdtBackground(request: Request, baseUrl: string): Promise<string | undefined> {
  const response = await request(DISCOVERY, { method: "GET" })
  if (XMLValidator.validate(response.body) !== true) throw new AppError("ADT_BACKGROUND_INVALID", "Invalid ADT core discovery XML")
  const root = xmlNode(fullParse(response.body, { removeNSPrefix: true, parseTagValue: false }), "service")
  if (root === undefined) throw new AppError("ADT_BACKGROUND_INVALID", "Missing ADT core discovery service")
  const matches = xmlArray(root, "workspace").flatMap(workspace => xmlArray<Record<string, unknown>>(workspace, "collection")).filter(collection =>
    xmlArray<Record<string, unknown>>(collection, "category").some(category =>
      category["@_scheme"] === "http://www.sap.com/adt/categories/system/communication/services" && category["@_term"] === "backgroundruns") &&
    xmlArray(collection, "accept").some(value => typeof value === "string" && value.trim().split(";", 1)[0]?.toLowerCase() === "application/http"))
  const base = new URL(DISCOVERY, baseUrl)
  const candidates = new Set(matches.map(collection => {
    const url = adtUrl(collection["@_href"], base, base.origin)
    if (url.search) throw new AppError("ADT_BACKGROUND_INVALID", "Unexpected query on the ADT background collection")
    return url.pathname.replace(/\/+$/, "")
  }))
  if (candidates.size > 1) throw new AppError("ADT_BACKGROUND_INVALID", "SAP advertised multiple distinct ADT background collections")
  return candidates.values().next().value
}

function runUri(value: unknown, baseUrl: string, parent: string): string {
  const base = new URL(parent, baseUrl)
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/`
  base.search = ""
  const url = adtUrl(value, base, base.origin)
  if (!url.pathname.startsWith(base.pathname) || url.pathname === base.pathname) {
    throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned a URI outside the selected background run")
  }
  return url.pathname + url.search
}

export function parseHttpResult(text: string): HttpClientResponse {
  const separator = /\r?\n\r?\n/.exec(text)
  const firstLine = /^HTTP\/1\.[01] (\d{3})(?: ([^\r\n]*))?\r?\n/.exec(text)
  if (!separator || !firstLine) throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned an invalid encapsulated HTTP response")
  const status = Number(firstLine[1])
  const headers: Record<string, string> = {}
  for (const line of text.slice(firstLine[0].length, separator.index).split(/\r?\n/)) {
    const colon = line.indexOf(":")
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
  }
  const body = text.slice(separator.index + separator[0].length)
  if (status < 200 || status >= 300) throw new AppError("ADT_BACKGROUND_OPERATION_FAILED", "The SAP background operation returned an unsuccessful HTTP status", { httpStatus: status, sapResponseText: body.slice(0, 8192) })
  return { status, statusText: firstLine[2] ?? "", headers, body }
}

/** ADT 3.62 BackgroundRestResource: application/http submission, run polling, application/http result. */
export async function runAdtBackground(request: Request, baseUrl: string, target: string, options: RequestOptions,
  timing = { timeoutMs: 120_000, pollMs: 10_000 }, collection = BASE): Promise<HttpClientResponse> {
  if (!target.startsWith("/sap/bc/adt/") || /[\r\n]/.test(target)) throw new AppError("ADT_BACKGROUND_INVALID", "Invalid ADT background target")
  const base = new URL(baseUrl)
  const collectionUrl = adtUrl(collection, base, base.origin)
  if (collectionUrl.search) throw new AppError("ADT_BACKGROUND_INVALID", "Unexpected query on the ADT background collection")
  const collectionPath = collectionUrl.pathname.replace(/\/+$/, "")
  const content = options.body ?? ""
  const innerHeaders = { ...options.headers, "Content-Length": String(Buffer.byteLength(content)) }
  const body = `${options.method ?? "POST"} ${target} HTTP/1.1\r\n` +
    Object.entries(innerHeaders).map(([name, value]) => `${name}: ${value}\r\n`).join("") + `\r\n${content}`
  const deadline = Date.now() + timing.timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  let phase = "submission"
  let polling: string | undefined
  // A submitted mutation is never resubmitted after a polling/result failure.
  let terminal = false
  try {
    const submitted = await request(collectionPath, { method: "POST", headers: { "Content-Type": "application/http" }, body, timeout: remaining() })
    polling = runUri(submitted.headers.location ?? submitted.headers.Location, baseUrl, collectionPath)
    phase = "polling"
    while (Date.now() < deadline) {
      const response = await request(polling, { method: "GET", headers: { Accept: MEDIA }, timeout: remaining() })
      const raw = fullParse(response.body)
      const run = xmlNode(raw, "runs:run")
      const state = run?.["@_runs:status"]
      if (["failed", "processNotStarted"].includes(state)) {
        terminal = true
        throw new AppError("ADT_BACKGROUND_FAILED", "SAP background execution failed", { status: state, pollingUri: polling })
      }
      if (state === "finished") {
        terminal = true
        phase = "result_fetch"
        const link = xmlArray<Record<string, string>>(run, "atom:link").find(link => link["@_rel"] === "http://www.sap.com/adt/relations/runs/result" && link["@_type"] === "application/http")
        const result = runUri(link?.["@_href"], baseUrl, polling)
        const response = await request(result, { method: "GET", headers: { Accept: "application/http" }, timeout: remaining() })
        phase = "operation_result"
        return parseHttpResult(response.body)
      }
      if (!["new", "running"].includes(state)) throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned an unknown background-run state", { pollingUri: polling })
      await new Promise(resolve => setTimeout(resolve, Math.min(timing.pollMs, remaining())))
    }
    throw new AppError("ADT_BACKGROUND_TIMEOUT", "The SAP background operation is still unverified. Inspect its state before retrying.", { pollingUri: polling })
  } catch (error) {
    throw withAdtPhase(error, { backgroundPhase: phase })
  } finally {
    // Retain pending runs so the caller can inspect them after a timeout.
    if (terminal && polling) await request(polling, { method: "DELETE", timeout: 5000 }).catch(() => undefined)
  }
}
