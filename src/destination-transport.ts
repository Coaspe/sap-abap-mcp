import { adtException, type HttpClient } from "abap-adt-api"
import type { HttpDestination } from "@sap-cloud-sdk/connectivity"
import type { Method } from "@sap-cloud-sdk/http-client"
import type { AdtTransportFactory } from "./transport-adt-client.js"

const destinationOwnedHeaders = new Set([
  "authorization", "proxy-authorization", "sap-connectivity-authentication",
  "sap-connectivity-scc-location_id", "host"
])
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

function validatePath(path: string): void {
  try {
    if (!path.startsWith("/sap/") || /[\\#\s\x00-\x1f]/.test(path)) throw new Error()
    const pathname = path.split("?")[0]!
    const decoded = decodeURIComponent(pathname)
    if (/[\\#\s\x00-\x1f]/.test(decoded) || decoded.split("/").some(part => part === "." || part === "..")) throw new Error()
  } catch {
    throw adtException("Destination ADT request requires a relative SAP path without traversal")
  }
}

/** Low-level bridge for an already resolved destination. This does not resolve or verify user identity. */
export async function createDestinationTransportFactory(destination: HttpDestination): Promise<AdtTransportFactory> {
  const { executeHttpRequest, encodeAllParameters } = await import("@sap-cloud-sdk/http-client")
  return () => ({
    async request(options) {
      validatePath(options.url)
      const method = (options.method ?? "GET").toUpperCase()
      if (!methods.has(method)) throw adtException("Unsupported Destination HTTP method")
      const headers = Object.fromEntries(Object.entries(options.headers ?? {})
        .filter(([name]) => !destinationOwnedHeaders.has(name.toLowerCase())))
      const response = await executeHttpRequest(destination, {
        url: options.url,
        method: method as Method,
        headers,
        ...(options.qs === undefined ? {} : { params: options.qs }),
        parameterEncoder: encodeAllParameters,
        data: options.body,
        ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
        responseType: "text",
        transformResponse: [(body: string) => body],
        validateStatus: () => true,
        maxRedirects: 0
      }, { fetchCsrfToken: false }).catch(() => {
        // SDK errors can contain exchanged tokens, proxy credentials and source.
        throw adtException("SAP Destination request failed before receiving an HTTP response")
      })
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        throw adtException("SAP Destination redirects are not allowed")
      }
      // ADT owns HTTP error classification, CSRF and cookies. Preserve 304 and
      // failure responses too, without retaining SDK configs containing tokens.
      const responseHeaders: Awaited<ReturnType<HttpClient["request"]>>["headers"] = {}
      for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ||
            value === null || (Array.isArray(value) && value.every(item => typeof item === "string"))) {
          responseHeaders[name.toLowerCase()] = value
        }
      }
      return {
        body: response.data, status: response.status, statusText: response.statusText,
        headers: responseHeaders
      }
    }
  })
}
