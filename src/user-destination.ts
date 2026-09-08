import type { Destination, HttpDestination } from "@sap-cloud-sdk/connectivity"
import { AppError } from "./errors.js"
import { createDestinationTransportFactory } from "./destination-transport.js"
import type { AdtTransportFactory } from "./transport-adt-client.js"

export interface UserDestinationRequest {
  destinationName: string
  expectedUrl: string
  sapClient: string
  authentication: "OAuth2UserTokenExchange" | "PrincipalPropagation"
  /** Must come from the authenticated HTTP caller, never a tool argument. */
  userJwt: string
}

type DestinationSdk = Pick<typeof import("@sap-cloud-sdk/connectivity"),
  "getDestinationFromDestinationService" | "alwaysSubscriber">

function invalidDestination(): never {
  throw new AppError("DESTINATION_MISMATCH", "SAP Destination does not match the configured endpoint, client or user authentication policy")
}

function endpoint(value: string, onPremise: boolean): string {
  try {
    const url = new URL(value)
    if ((!onPremise && url.protocol !== "https:") ||
        (onPremise && !["http:", "https:"].includes(url.protocol)) ||
        url.username || url.password || url.search || url.hash) invalidDestination()
    return url.href.replace(/\/+$/, "")
  } catch {
    return invalidDestination()
  }
}

function validateDestination(destination: Destination, request: UserDestinationRequest): HttpDestination {
  const onPremise = request.authentication === "PrincipalPropagation"
  if (!destination.url || destination.authentication !== request.authentication ||
      endpoint(destination.url, onPremise) !== endpoint(request.expectedUrl, onPremise) ||
      destination.isTrustingAllCertificates || destination.forwardAuthToken ||
      (destination.sapClient && destination.sapClient !== request.sapClient) ||
      (onPremise ? destination.proxyType !== "OnPremise" : destination.proxyType === "OnPremise")) invalidDestination()

  // Destination properties can override generated authentication headers. Those
  // values must not silently replace the SDK's user exchange/propagation result.
  const properties = { ...destination.originalProperties, ...destination.originalProperties?.destinationConfiguration }
  const configuredHeaders = {
    ...destination.headers,
    ...Object.fromEntries(Object.entries(properties)
      .filter(([key]) => key.toLowerCase().startsWith("url.headers."))
      .map(([key, value]) => [key.slice("url.headers.".length), value]))
  }
  if (destination.systemUser || (properties.SystemUser && String(properties.SystemUser).toLowerCase() !== "false")) invalidDestination()
  for (const [name, value] of Object.entries(configuredHeaders)) {
    if (["authorization", "proxy-authorization", "sap-connectivity-authentication", "host"].includes(name.toLowerCase())) invalidDestination()
    if (name.toLowerCase() === "sap-client" && value !== request.sapClient) invalidDestination()
  }
  for (const [name, value] of Object.entries(destination.queryParameters ?? {})) {
    if (name.toLowerCase() === "sap-client" && value !== request.sapClient) invalidDestination()
  }
  for (const [name, value] of Object.entries(properties)) {
    if (name.toLowerCase() === "url.queries.sap-client" && value !== request.sapClient) invalidDestination()
  }
  if (onPremise) {
    const headers = destination.proxyConfiguration?.headers
    if (!/^Bearer [^\s]+$/i.test(headers?.["Proxy-Authorization"] ?? "") ||
        !/^Bearer [^\s]+$/i.test(headers?.["SAP-Connectivity-Authentication"] ?? "")) invalidDestination()
  } else {
    const tokens = destination.authTokens ?? []
    if (tokens.length !== 1 || tokens.some(token => token.error ||
      token.http_header?.key.toLowerCase() !== "authorization" ||
      !/^Bearer [^\s]+$/i.test(token.http_header.value) ||
      (token.expiresIn !== undefined && !(Number(token.expiresIn) > 0)))) invalidDestination()
  }
  return destination as HttpDestination
}

/** Service-only, per-call resolution. This function does not authenticate the incoming JWT. */
export async function resolveUserDestination(request: UserDestinationRequest, injectedSdk?: DestinationSdk): Promise<HttpDestination> {
  if (!request.userJwt || /\s/.test(request.userJwt)) {
    throw new AppError("AUTH_REQUIRED", "An authenticated caller token is required for SAP Destination access")
  }
  if (!request.destinationName.trim() || !/^\d{3}$/.test(request.sapClient)) invalidDestination()
  endpoint(request.expectedUrl, request.authentication === "PrincipalPropagation")
  const sdk = injectedSdk ?? await import("@sap-cloud-sdk/connectivity")
  let destination: Destination | null
  try {
    destination = await sdk.getDestinationFromDestinationService({
      destinationName: request.destinationName,
      jwt: request.userJwt,
      useCache: false,
      selectionStrategy: sdk.alwaysSubscriber
    })
  } catch {
    throw new AppError("DESTINATION_UNAVAILABLE", "SAP Destination lookup failed; check service bindings and caller access")
  }
  if (!destination) throw new AppError("DESTINATION_NOT_FOUND", "SAP Destination was not found in the caller's subscriber account")
  return validateDestination(destination, request)
}

/** Refresh exchanged/proxy credentials for every ADT request; never fall back to a previous destination. */
export function createUserDestinationTransportFactory(
  request: UserDestinationRequest,
  injectedSdk?: DestinationSdk
): AdtTransportFactory {
  const boundRequest = Object.freeze({ ...request })
  return () => ({
    async request(options) {
      const destination = await resolveUserDestination(boundRequest, injectedSdk)
      const factory = await createDestinationTransportFactory(destination)
      return factory().request(options)
    }
  })
}
