import { fullParse, xmlArray, xmlNode } from "abap-adt-api/build/utilities.js"
import type { RequestOptions, HttpClientResponse } from "abap-adt-api/build/AdtHTTP.js"
import { AppError } from "./errors.js"

type Request = (uri: string, options: RequestOptions) => Promise<HttpClientResponse>
const BASE = "/sap/bc/adt/communication/bgruns"
const MEDIA = "application/vnd.sap.adt.bgrun.v1+xml"

function runUri(value: unknown, baseUrl: string, polling?: string): string {
  if (typeof value !== "string" || !value) throw new AppError("ADT_BACKGROUND_INVALID", "SAP did not return a background-run URI")
  const relative = new URL(polling ?? `${BASE}/`, baseUrl)
  if (polling) { relative.pathname += "/"; relative.search = "" }
  const url = new URL(value, relative)
  if (url.origin !== new URL(baseUrl).origin || url.username || url.password || url.hash ||
      !url.pathname.startsWith(`${BASE}/`) || /%2f|%5c|%2e/i.test(url.pathname)) {
    throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned a background-run URI outside this system's background-run resource")
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
  timing = { timeoutMs: 120_000, pollMs: 10_000 }): Promise<HttpClientResponse> {
  if (!target.startsWith("/sap/bc/adt/") || /[\r\n]/.test(target)) throw new AppError("ADT_BACKGROUND_INVALID", "Invalid ADT background target")
  const content = options.body ?? ""
  const innerHeaders = { ...options.headers, "Content-Length": String(Buffer.byteLength(content)) }
  const body = `${options.method ?? "POST"} ${target} HTTP/1.1\r\n` +
    Object.entries(innerHeaders).map(([name, value]) => `${name}: ${value}\r\n`).join("") + `\r\n${content}`
  const deadline = Date.now() + timing.timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  const submitted = await request(BASE, { method: "POST", headers: { "Content-Type": "application/http" }, body, timeout: remaining() })
  const polling = runUri(submitted.headers.location ?? submitted.headers.Location, baseUrl)
  // A submitted mutation is never resubmitted after a polling/result failure.
  let terminal = false
  try {
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
        const link = xmlArray<Record<string, string>>(run, "atom:link").find(link => link["@_rel"] === "http://www.sap.com/adt/relations/runs/result" && link["@_type"] === "application/http")
        const result = runUri(link?.["@_href"], baseUrl, polling)
        const response = await request(result, { method: "GET", headers: { Accept: "application/http" }, timeout: remaining() })
        return parseHttpResult(response.body)
      }
      if (!["new", "running"].includes(state)) throw new AppError("ADT_BACKGROUND_INVALID", "SAP returned an unknown background-run state", { pollingUri: polling })
      await new Promise(resolve => setTimeout(resolve, Math.min(timing.pollMs, remaining())))
    }
    throw new AppError("ADT_BACKGROUND_TIMEOUT", "The SAP background operation is still unverified. Inspect its state before retrying.", { pollingUri: polling })
  } finally {
    // Retain pending runs so the caller can inspect them after a timeout.
    if (terminal) await request(polling, { method: "DELETE", timeout: 5000 }).catch(() => undefined)
  }
}
